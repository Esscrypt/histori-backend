variable "aws_region" {
  description = "AWS region to deploy the EC2 instance"
  type        = string
  default     = "us-east-1"
}

variable "aws_access_key" {
  description = "Your AWS access key"
  type        = string
}

variable "aws_secret_key" {
  description = "Your AWS secret access key"
  type        = string
}

variable "github_pat" {
  description = "GitHub Personal Access Token"
  type        = string
}

variable "user_id" {
  description = "User ID to pass to the setup script and for tagging resources"
  type        = string
}

variable "instance_type" {
  type        = string
  default     = "t2.micro"
}

variable "local_env_file_path" {
  description = "The path to the local .env.instance file"
  type        = string
  default = ".env.instance"
}

provider "aws" {
  region     = var.aws_region  # Use the region from the variable
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
}

# Security Group to allow SSH and port 3000
resource "aws_security_group" "allow_ssh_and_3000" {
  name        = "allow_ssh_and_3000"
  description = "Allow SSH and port 3000 access"

  ingress {
    description      = "SSH"
    from_port        = 22
    to_port          = 22
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
  }

  ingress {
    description      = "Allow port 3000"
    from_port        = 3000
    to_port          = 3000
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
  }

  egress {
    description      = "Allow all outbound"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
  }

  tags = {
    "UserID" = var.user_id  # Tag with the User ID
  }
}

# Key Pair for SSH access
resource "aws_key_pair" "generated_key" {
  key_name   = "generated-key"
  public_key = file("~/.ssh/id_rsa.pub")  # Ensure this key exists
  tags = {
    "UserID" = var.user_id  # Tag with the User ID
  }
}

# Create an IAM role
resource "aws_iam_role" "ec2_role" {
  name = "EC2RoleForSSM"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

}

# Attach the AmazonEC2RoleforSSM managed policy to the role
resource "aws_iam_role_policy_attachment" "ec2_role_ssm" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"

}

# Create an instance profile to use this role
resource "aws_iam_instance_profile" "ec2_instance_profile" {
  name = "EC2InstanceProfileForSSM"
  role = aws_iam_role.ec2_role.name
}

# EC2 Instance with Reserved Pricing (t4g.micro)
resource "aws_instance" "free" {
  ami           = "ami-0fff1b9a61dec8a5f"  # Amazon Linux 2 AMI (Check the latest in your region)
  instance_type = var.instance_type
  key_name      = aws_key_pair.generated_key.key_name
  security_groups = [aws_security_group.allow_ssh_and_3000.name]

  associate_public_ip_address = true  # Attach public IP to the instance

  # Attach the instance profile that includes AmazonEC2RoleforSSM
  iam_instance_profile = aws_iam_instance_profile.ec2_instance_profile.name

  user_data_replace_on_change = true

  user_data = <<-EOF
    #!/bin/bash
    sudo su -
    exec > /var/log/user_data.log 2>&1  # Redirect output to log file
    set -x  # Enable debugging mode
    yum update -y
    yum install -y nginx git nodejs npm

    npm install -g npm@latest

    # Set up NGINX rate limiting
    echo 'limit_req_zone $binary_remote_addr zone=one:10m rate=50r/s;' > /etc/nginx/conf.d/rate_limit.conf

    # Include the rate limit in the NGINX server block
    mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

    echo 'server { listen 80; location / { limit_req zone=one burst=10 nodelay; proxy_pass http://localhost:3000; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; } }' > /etc/nginx/sites-available/default

    # Reload NGINX to apply changes
    ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/
    nginx -t  # Test the configuration
    systemctl enable nginx
    systemctl start nginx  # Reload Nginx to apply the changes

    # Clone and run histori-rest-api, pass the GitHub PAT and user ID
    git clone https://${var.github_pat}@github.com/Esscrypt/histori-rest-api.git
    cd histori-rest-api

    # Fetch the .env from AWS Parameter Store and save it to a .env file
    touch .env
    aws ssm get-parameter --name "/histori/env" --with-decryption --query "Parameter.Value" --output text > .env

    # Give execution permissions to setup.sh
    chmod +x setup.sh

    # Run the setup.sh script
    ./setup.sh
  EOF



  tags = {
    "UserID" = var.user_id  # Tag with the User ID
  }
}

resource "aws_eip" "elastic_ip" {
  vpc = true
  tags = {
    "UserID" = var.user_id  # Tag with the User ID
  }
}

resource "aws_eip_association" "eip_assoc" {
  instance_id = aws_instance.free.id
  allocation_id = aws_eip.elastic_ip.id
}

# Output the public IP of the instance
output "instance_public_ip" {
  description = "Public IP of the reserved t4g.micro instance"
  value       = aws_eip_association.eip_assoc.public_ip
}