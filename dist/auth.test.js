import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword, requireRole } from "./auth.js";
describe("password credentials", () => {
    it("stores a salted scrypt hash and verifies only the matching password", async () => {
        const encoded = await hashPassword("correct horse battery staple");
        expect(encoded).not.toContain("correct horse");
        expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
        expect(await verifyPassword("wrong password", encoded)).toBe(false);
    });
    it("rejects malformed stored hashes", async () => {
        expect(await verifyPassword("password", "malformed")).toBe(false);
    });
});
describe("server-side role checks", () => {
    it("rejects a viewer before protected work reaches the route handler", () => {
        const next = vi.fn();
        const status = vi.fn().mockReturnThis();
        const json = vi.fn();
        const guard = requireRole("OWNER", "ADMIN", "MANAGER");
        guard({ auth: { userId: "u1", organizationId: "o1", role: "VIEWER" } }, { status, json }, next);
        expect(status).toHaveBeenCalledWith(403);
        expect(json).toHaveBeenCalledWith({ error: { code: "forbidden", message: "Your role cannot perform this action." } });
        expect(next).not.toHaveBeenCalled();
    });
    it("allows an admin to continue", () => {
        const next = vi.fn();
        const guard = requireRole("OWNER", "ADMIN", "MANAGER");
        guard({ auth: { userId: "u1", organizationId: "o1", role: "ADMIN" } }, {}, next);
        expect(next).toHaveBeenCalledOnce();
    });
});
