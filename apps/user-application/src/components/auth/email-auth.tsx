import { Turnstile } from "@marsidev/react-turnstile";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

interface AuthError {
	message: string;
}

export function EmailAuth() {
	const navigate = useNavigate();
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: async (data: { email: string; password: string }) => {
			const result = await authClient.signIn.email({
				email: data.email,
				password: data.password,
				fetchOptions: { body: { turnstileToken } },
			});
			if (result.error) throw new Error(result.error.message);
			return result;
		},
	});

	const form = useForm({
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			mutation.reset();
			await mutation.mutateAsync(value);
			toast.success("Zalogowano");
			navigate({ to: "/dashboard" });
		},
	});

	return (
		<div className="min-h-screen flex items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<CardTitle className="text-2xl font-bold text-foreground">Welcome back</CardTitle>
					<CardDescription>Sign in to your account</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{mutation.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								{(mutation.error as AuthError).message ?? "Something went wrong"}
							</AlertDescription>
						</Alert>
					)}

					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-4"
					>
						<form.Field
							name="email"
							validators={{
								onChange: ({ value }) => {
									if (!value) return "Email is required";
									if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Invalid email";
								},
							}}
						>
							{(field) => (
								<div className="space-y-1">
									<label htmlFor={field.name} className="text-sm font-medium text-foreground">
										Email
									</label>
									<Input
										id={field.name}
										type="email"
										placeholder="you@example.com"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									{field.state.meta.errors.map((error) => (
										<p key={String(error)} className="text-destructive text-sm">
											{error}
										</p>
									))}
								</div>
							)}
						</form.Field>

						<form.Field
							name="password"
							validators={{
								onChange: ({ value }) => {
									if (!value) return "Password is required";
									if (value.length < 8) return "Min 8 characters";
								},
							}}
						>
							{(field) => (
								<div className="space-y-1">
									<label htmlFor={field.name} className="text-sm font-medium text-foreground">
										Password
									</label>
									<Input
										id={field.name}
										type="password"
										placeholder="Min 8 characters"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									{field.state.meta.errors.map((error) => (
										<p key={String(error)} className="text-destructive text-sm">
											{error}
										</p>
									))}
								</div>
							)}
						</form.Field>

						<Turnstile
							siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
							onSuccess={setTurnstileToken}
							onExpire={() => setTurnstileToken(null)}
						/>

						<form.Subscribe selector={(state) => state.canSubmit}>
							{(canSubmit) => (
								<Button
									type="submit"
									className="w-full h-12"
									disabled={!canSubmit || !turnstileToken || mutation.isPending}
								>
									{mutation.isPending ? "Loading..." : "Sign In"}
								</Button>
							)}
						</form.Subscribe>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
