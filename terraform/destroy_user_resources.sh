#!/bin/bash

# Check if the required arguments are provided
if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <aws_region> <aws_access_key> <aws_secret_key> <github_pat> <user_id>"
  exit 1
fi

# Assign CLI arguments to variables
aws_region=$1
aws_access_key=$2
aws_secret_key=$3
github_pat=$4
user_id=$5  # Fix variable to match usage in the command

# Run the terraform destroy command with the arguments
DESTROY_CMD="terraform destroy \
   -var=\"aws_region=${aws_region}\" \
   -var=\"aws_access_key=${aws_access_key}\" \
   -var=\"aws_secret_key=${aws_secret_key}\" \
   -var=\"github_pat=${github_pat}\" \
   -var=\"user_id=${user_id}\" \
   -auto-approve"

# Get all resource addresses associated with the User ID
RESOURCES=$(terraform show -json | jq -r --arg user_id "$user_id" '.values.root_module.resources[] | select(.values.tags.UserID == $user_id) | .address')

for resource in $RESOURCES; do
  DESTROY_CMD="$DESTROY_CMD -target=$resource"
done

# Execute the command
echo "Running: $DESTROY_CMD"
eval $DESTROY_CMD  # Use eval to execute the constructed command
