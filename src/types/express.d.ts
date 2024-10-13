import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    userId: number; // Assuming user ID is a number, you can adjust this type
    // You can add more properties here if needed, e.g., email, roles, etc.
  };
}
