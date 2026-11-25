import { z } from "zod";

export const bulkBacklinkQuerySchema = z.object({
  projectIds: z.string().min(1)
    .transform((value) => [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))])
    .pipe(z.array(z.string().min(1)).min(1).max(20)),
});
