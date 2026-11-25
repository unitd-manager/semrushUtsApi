import { z } from "zod";
export declare const bulkBacklinkQuerySchema: z.ZodObject<{
    projectIds: z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string[], string>>, z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
