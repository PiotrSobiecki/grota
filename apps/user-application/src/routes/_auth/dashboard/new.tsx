import { DEPARTMENT_SUGGESTIONS, MAX_DEPARTMENTS_PER_DEPLOYMENT } from "@repo/data-ops/department";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createDepartmentsBulk } from "@/core/functions/departments/binding";
import { createNewDeployment } from "@/core/functions/deployments/direct";

export const Route = createFileRoute("/_auth/dashboard/new")({
	component: CreateDeploymentPage,
});

interface DepartmentSelection {
	name: string;
	slug: string;
}

const DEFAULT_SELECTED_SLUGS = new Set(["zarzad", "ksiegowosc", "projekty", "media"]);

function CreateDeploymentPage() {
	const navigate = useNavigate();

	const [selectedDepartments, setSelectedDepartments] = useState<DepartmentSelection[]>(
		DEPARTMENT_SUGGESTIONS.filter((d) => DEFAULT_SELECTED_SLUGS.has(d.slug)),
	);
	const [customDeptName, setCustomDeptName] = useState("");

	const mutation = useMutation({
		mutationFn: async (data: {
			clientName: string;
			domain: string;
			adminEmail?: string;
			adminName?: string;
		}) => {
			const deployment = await createNewDeployment({ data });
			if (selectedDepartments.length > 0) {
				await createDepartmentsBulk({
					data: {
						deploymentId: deployment.id,
						departments: selectedDepartments.map((d) => ({ name: d.name })),
					},
				});
			}
			return deployment;
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
				adminEmail: value.adminEmail || undefined,
				adminName: value.adminName || undefined,
			});
			toast.success("Wdrozenie utworzone");
			navigate({ to: "/dashboard/$id", params: { id: result.id } });
		},
	});

	const atLimit = selectedDepartments.length >= MAX_DEPARTMENTS_PER_DEPLOYMENT;

	const toggleSuggestion = (suggestion: DepartmentSelection) => {
		setSelectedDepartments((prev) => {
			const exists = prev.some((d) => d.slug === suggestion.slug);
			if (exists) return prev.filter((d) => d.slug !== suggestion.slug);
			return [...prev, suggestion];
		});
	};

	const addCustomDepartment = () => {
		const trimmed = customDeptName.trim();
		if (!trimmed) return;
		const slug = trimmed
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		if (selectedDepartments.some((d) => d.slug === slug)) return;
		setSelectedDepartments((prev) => [...prev, { name: trimmed, slug }]);
		setCustomDeptName("");
	};

	const removeDepartment = (slug: string) => {
		setSelectedDepartments((prev) => prev.filter((d) => d.slug !== slug));
	};

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

						<form.Field name="adminEmail">
							{(field) => (
								<div className="space-y-2">
									<label htmlFor="adminEmail" className="text-sm font-medium text-foreground">
										Email administratora klienta (opcjonalnie)
									</label>
									<Input
										id="adminEmail"
										type="email"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder="admin@firma.pl"
									/>
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

						{/* Departments section */}
						<div className="space-y-3">
							<span className="text-sm font-medium text-foreground">
								Dzialy{" "}
								<span className="font-normal text-muted-foreground">
									({selectedDepartments.length}/{MAX_DEPARTMENTS_PER_DEPLOYMENT})
								</span>
							</span>
							<div className="flex flex-wrap gap-2">
								{DEPARTMENT_SUGGESTIONS.map((s) => {
									const isSelected = selectedDepartments.some((d) => d.slug === s.slug);
									const disabled = !isSelected && atLimit;
									return (
										<button
											key={s.slug}
											type="button"
											onClick={() => !disabled && toggleSuggestion(s)}
											disabled={disabled}
											className={`rounded-full border px-3 py-1 text-sm transition-colors ${
												isSelected
													? "border-primary bg-primary text-primary-foreground"
													: disabled
														? "border-border bg-background text-muted-foreground opacity-50 cursor-not-allowed"
														: "border-border bg-background text-foreground hover:bg-muted"
											}`}
										>
											{s.name}
										</button>
									);
								})}
							</div>

							<div className="flex gap-2">
								<Input
									placeholder={atLimit ? "Osiagnieto limit dzialow" : "Wlasny dzial..."}
									disabled={atLimit}
									value={customDeptName}
									onChange={(e) => setCustomDeptName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											addCustomDepartment();
										}
									}}
								/>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={addCustomDepartment}
									disabled={atLimit}
								>
									<Plus className="h-4 w-4" />
								</Button>
							</div>

							{selectedDepartments.length > 0 && (
								<div className="flex flex-wrap gap-2">
									{selectedDepartments.map((d) => (
										<span
											key={d.slug}
											className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground"
										>
											{d.name}
											<button
												type="button"
												onClick={() => removeDepartment(d.slug)}
												className="text-muted-foreground hover:text-foreground"
											>
												<X className="h-3 w-3" />
											</button>
										</span>
									))}
								</div>
							)}
						</div>

						{selectedDepartments.length === 0 && (
							<p className="text-sm text-destructive">Wybierz przynajmniej jeden dzial</p>
						)}

						<form.Subscribe selector={(s) => s.canSubmit}>
							{(canSubmit) => (
								<Button
									type="submit"
									disabled={!canSubmit || mutation.isPending || selectedDepartments.length === 0}
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
