import { z } from "zod";
import { B2ConfigSchema, ServerConfigSchema } from "../deployment/schema";

export const ConfigJsonSchema = z.object({
	deployment_id: z.string().uuid(),
	client_name: z.string(),
	domain: z.string(),
	created_at: z.string(),
	workspace: z
		.object({
			oauth_refresh_token: z.string(),
			shared_drives: z.array(
				z.object({
					name: z.string(),
					category: z.string(),
					id: z.string().nullable().optional(),
				}),
			),
		})
		.nullable(),
	accounts: z.array(
		z.object({
			email: z.string(),
			name: z.string(),
			oauth_refresh_token: z.string().nullable(),
			folders: z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					category: z.string(),
				}),
			),
		}),
	),
	b2: B2ConfigSchema.nullable(),
	server: ServerConfigSchema.nullable(),
});

export type ConfigJson = z.infer<typeof ConfigJsonSchema>;
