import { z } from "zod";

export const ConfigJsonSchema = z.object({
	deployment_id: z.string().uuid(),
	client_name: z.string(),
	domain: z.string(),
	created_at: z.string(),
	workspace: z
		.object({
			oauth_refresh_token: z.string(),
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
	b2: z.unknown().nullable(),
	server: z.unknown().nullable(),
});

export type ConfigJson = z.infer<typeof ConfigJsonSchema>;
