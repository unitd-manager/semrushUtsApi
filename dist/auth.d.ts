import type { NextFunction, Request, Response } from "express";
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, saved: string): Promise<boolean>;
export declare function issueSession(userId: string, organizationId: string): string;
export declare function setSessionCookie(res: Response, token: string): void;
export declare function clearSessionCookie(res: Response): void;
export type AuthenticatedRequest = Request & {
    auth?: {
        userId: string;
        organizationId: string;
        role: string;
    };
};
export declare function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>;
export declare function requireRole(...roles: string[]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
