
## Running the Project Using Docker
### rerequisites
- **Docker**: Ensure that Docker is installed on your system. You can download and install Docker from the official website: https://www.docker.com/get-started

## HOST NETWORKING
> Host networking is supported on Docker Desktop version 4.34 and later. To enable this feature:
1. Sign in to your Docker account in Docker Desktop.
2. Navigate to Settings.
3. Under the Resources tab, select Network.
4. Check the Enable host networking option.
5. Select Apply and restart.

## Environment variables
Copy the example files and fill in the values
```bash
cp .env.development.example .env.development
cp .env.example .env
```

## Build and Run the Application

You can build and run the application using Docker by executing the following commands:

```bash
# Run the application
docker-compose build --no-cache
docker-compose up
```

This will start both your backend, frontend and a PostgreSQL database (if defined in your docker-compose.yml). Your app will be accessible on http://localhost:4242.

## Stopping the Application

To stop the running containers, simply run:

```bash
docker-compose down
```

## Terraform
```bash
cd terraform && terraform init
```
