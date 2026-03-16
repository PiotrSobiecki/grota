import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createNewDeployment } from "@/core/functions/deployments/direct";

export const Route = createFileRoute("/_auth/dashboard/new")({
	component: CreateDeploymentPage,
});

function CreateDeploymentPage() {
	const navigate = useNavigate();

	const mutation = useMutation({
		mutationFn: async (data: {
			clientName: string;
			domain: string;
			adminEmail: string;
			adminName?: string;
		}) => {
			return createNewDeployment({ data });
		},
	});

	const form = useForm({
		defaultValues: {
			clientName: "",
			domain: "",
			adminEmail: "",
			adminName: "",
		},
		onSubmit: async ({ value }) => {
			mutation.reset();
			const result = await mutation.mutateAsync({
				clientName: value.clientName,
				domain: value.domain,
				adminEmail: value.adminEmail,
				adminName: value.adminName || undefined,
			});
			toast.success("Wdrozenie utworzone");
			navigate({ to: "/dashboard/$id", params: { id: result.id } });
		},
	});

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			<h1 className="text-2xl font-bold text-foreground">Nowe wdrozenie</h1>

			<Card>
				<CardHeader>
					<CardTitle>Dane klienta</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-4"
					>
						{mutation.isError && <Alert variant="destructive">{mutation.error.message}</Alert>}

						<form.Field
							name="clientName"
							validators={{
								onChange: ({ value }) => (!value ? "Nazwa klienta jest wymagana" : undefined),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<label htmlFor="clientName" className="text-sm font-medium text-foreground">
										Nazwa klienta
									</label>
									<Input
										id="clientName"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder="FirmaXYZ Sp. z o.o."
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="domain"
							validators={{
								onChange: ({ value }) => (!value ? "Domena jest wymagana" : undefined),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<label htmlFor="domain" className="text-sm font-medium text-foreground">
										Domena
									</label>
									<Input
										id="domain"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder="firma.pl"
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="adminEmail"
							validators={{
								onChange: ({ value }) =>
									!value ? "Email administratora jest wymagany" : undefined,
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<label htmlFor="adminEmail" className="text-sm font-medium text-foreground">
										Email administratora klienta
									</label>
									<Input
										id="adminEmail"
										type="email"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder="admin@firma.pl"
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field name="adminName">
							{(field) => (
								<div className="space-y-2">
									<label htmlFor="adminName" className="text-sm font-medium text-foreground">
										Imie i nazwisko administratora (opcjonalnie)
									</label>
									<Input
										id="adminName"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder="Jan Kowalski"
									/>
								</div>
							)}
						</form.Field>

						<form.Subscribe selector={(s) => s.canSubmit}>
							{(canSubmit) => (
								<Button
									type="submit"
									disabled={!canSubmit || mutation.isPending}
									className="w-full"
								>
									{mutation.isPending ? "Tworzenie..." : "Utworz wdrozenie"}
								</Button>
							)}
						</form.Subscribe>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
