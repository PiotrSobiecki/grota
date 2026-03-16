import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmStep } from "@/components/employee/confirm-step";
import { DriveNavigator, type SelectedItem } from "@/components/employee/drive-navigator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EmployeeSearchParams {
	step: number;
	oauth?: string;
	employeeId?: string;
}

interface SharedDriveOption {
	id: string;
	name: string;
}

export const Route = createFileRoute("/employee/$token")({
	validateSearch: (search: Record<string, unknown>): EmployeeSearchParams => ({
		step: Number(search.step) || 1,
		oauth: typeof search.oauth === "string" ? search.oauth : undefined,
		employeeId: typeof search.employeeId === "string" ? search.employeeId : undefined,
	}),
	component: EmployeeFlow,
});

function EmployeeFlow() {
	const { token } = Route.useParams();
	const { step, oauth, employeeId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
	const [selections, setSelections] = useState<SelectedItem[]>([]);
	const [sharedDrives, setSharedDrives] = useState<SharedDriveOption[]>([]);

	const effectiveStep = step >= 2 && !employeeId ? 1 : step;

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Grota -- Wybor folderow</h1>

				<div className="flex gap-2">
					{[1, 2, 3].map((s) => (
						<div
							key={s}
							className={`h-2 flex-1 rounded ${s <= effectiveStep ? "bg-primary" : "bg-muted"}`}
						/>
					))}
				</div>

				{effectiveStep === 1 && (
					<DriveOAuthStep
						token={token}
						oauthSuccess={oauth === "success"}
						onNext={(resolvedEmployeeId, drives) => {
							setSharedDrives(drives);
							navigate({ search: { step: 2, employeeId: resolvedEmployeeId } });
						}}
					/>
				)}
				{effectiveStep === 2 && employeeId && (
					<DriveNavigator
						employeeId={employeeId}
						dataServiceUrl={dataServiceUrl}
						sharedDrives={sharedDrives}
						selections={selections}
						onSelectionsChange={setSelections}
					/>
				)}
				{effectiveStep === 2 && employeeId && selections.length >= 0 && (
					<div className="flex justify-end">
						<Button
							onClick={() =>
								navigate({
									search: (prev) => ({
										step: 3,
										employeeId: prev.employeeId,
									}),
								})
							}
						>
							Dalej
						</Button>
					</div>
				)}
				{effectiveStep === 3 && employeeId && (
					<ConfirmStep
						employeeId={employeeId}
						selections={selections}
						sharedDrives={sharedDrives}
					/>
				)}
			</div>
		</div>
	);
}

interface DriveOAuthStepProps {
	token: string;
	oauthSuccess: boolean;
	onNext: (employeeId: string, sharedDrives: SharedDriveOption[]) => void;
}

function DriveOAuthStep({ token, oauthSuccess, onNext }: DriveOAuthStepProps) {
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;

	const verifyMutation = useMutation({
		mutationFn: async () => {
			const response = await fetch(`${dataServiceUrl}/magic-links/verify/employee/${token}`);
			if (!response.ok) throw new Error("Nie udalo sie zweryfikowac tokenu");
			return response.json() as Promise<{
				employeeId: string;
				sharedDrives: SharedDriveOption[];
			}>;
		},
		onSuccess: (data) => {
			toast.success("Token zweryfikowany");
			onNext(data.employeeId, data.sharedDrives);
		},
		onError: (error) => toast.error(error.message),
	});

	const handleAuthorize = () => {
		window.location.href = `${dataServiceUrl}/api/oauth/google/authorize?type=employee&id=${token}`;
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 1: Autoryzacja Google Drive</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
					<p className="font-medium text-foreground">Co zobaczy aplikacja:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Nazwy folderow i plikow na poziomach, ktore przegladasz</li>
					</ul>
					<p className="font-medium text-foreground">Czego NIE zobaczy:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Tresci plikow</li>
					</ul>
					<p className="text-sm text-muted-foreground">
						Mozesz cofnac dostep w dowolnym momencie w{" "}
						<a
							href="https://myaccount.google.com/permissions"
							target="_blank"
							rel="noopener noreferrer"
							className="underline text-primary hover:text-primary/80"
						>
							ustawieniach Google
						</a>
						.
					</p>
				</div>

				{oauthSuccess ? (
					<div className="space-y-2">
						<p className="text-sm text-green-600 dark:text-green-400">
							Autoryzacja zakonczona pomyslnie.
						</p>
						<Button onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
							{verifyMutation.isPending ? "Ladowanie..." : "Dalej"}
						</Button>
					</div>
				) : (
					<Button onClick={handleAuthorize}>Autoryzuj Google Drive</Button>
				)}
			</CardContent>
		</Card>
	);
}
