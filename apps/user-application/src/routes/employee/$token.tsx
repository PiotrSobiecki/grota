import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EmployeeSearchParams {
	step: number;
	oauth?: string;
	employeeId?: string;
}

export const Route = createFileRoute("/employee/$token")({
	validateSearch: (search: Record<string, unknown>): EmployeeSearchParams => ({
		step: Number(search.step) || 1,
		oauth: typeof search.oauth === "string" ? search.oauth : undefined,
		employeeId: typeof search.employeeId === "string" ? search.employeeId : undefined,
	}),
	component: EmployeeFlow,
});

interface DriveFolder {
	id: string;
	name: string;
	mimeType: string;
	suggestedCategory: string | null;
}

// Used by step 3 (doc 005b)
// biome-ignore lint/correctness/noUnusedVariables: pre-defined for 005b
const CATEGORY_INFO: Record<string, { label: string; description: string }> = {
	dokumenty: { label: "Dokumenty", description: "Faktury, umowy, ksiegowosc" },
	projekty: { label: "Projekty", description: "Dokumentacja projektowa" },
	media: { label: "Media", description: "Zdjecia, filmy" },
	prywatne: { label: "Prywatne (pomijane)", description: "Nie bedzie backupowane" },
};

function EmployeeFlow() {
	const { token } = Route.useParams();
	const { step, oauth, employeeId } = Route.useSearch();
	const navigate = Route.useNavigate();

	const effectiveStep = step >= 2 && !employeeId ? 1 : step;

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Grota — Wybor folderow</h1>

				<div className="flex gap-2">
					{[1, 2, 3, 4].map((s) => (
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
						onNext={(resolvedEmployeeId) => {
							navigate({ search: { step: 2, employeeId: resolvedEmployeeId } });
						}}
					/>
				)}
				{effectiveStep === 2 && employeeId && (
					<FolderListStep
						employeeId={employeeId}
						onLoaded={() => {
							navigate({
								search: (prev) => ({
									step: 3,
									employeeId: prev.employeeId,
								}),
							});
						}}
					/>
				)}
				{effectiveStep === 3 && (
					<Card>
						<CardContent className="py-8 text-center">
							<p className="text-muted-foreground">Krok 3: Przypisywanie kategorii (doc 005b)</p>
						</CardContent>
					</Card>
				)}
				{effectiveStep === 4 && (
					<Card>
						<CardContent className="py-8 text-center">
							<p className="text-muted-foreground">Krok 4: Potwierdzenie (doc 005b)</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}

interface DriveOAuthStepProps {
	token: string;
	oauthSuccess: boolean;
	onNext: (employeeId: string) => void;
}

function DriveOAuthStep({ token, oauthSuccess, onNext }: DriveOAuthStepProps) {
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;

	const verifyMutation = useMutation({
		mutationFn: async () => {
			const response = await fetch(`${dataServiceUrl}/magic-links/verify/employee/${token}`);
			if (!response.ok) throw new Error("Nie udalo sie zweryfikowac tokenu");
			return response.json() as Promise<{ employeeId: string }>;
		},
		onSuccess: (data) => onNext(data.employeeId),
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
						<li>Nazwy folderow najwyzszego poziomu</li>
					</ul>
					<p className="font-medium text-foreground">Czego NIE zobaczy:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Tresci plikow</li>
						<li>Plikow wewnatrz folderow</li>
					</ul>
					<p className="text-sm text-muted-foreground">
						Mozesz cofnac dostep w dowolnym momencie w ustawieniach Google
						(myaccount.google.com/permissions).
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

function FolderListStep({ employeeId, onLoaded }: { employeeId: string; onLoaded: () => void }) {
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;

	const foldersQuery = useQuery({
		queryKey: ["drive-folders", employeeId],
		queryFn: async () => {
			const response = await fetch(`${dataServiceUrl}/folders/drive/${employeeId}`);
			if (!response.ok) throw new Error("Nie udalo sie pobrac folderow");
			return response.json() as Promise<{ folders: DriveFolder[] }>;
		},
	});

	useEffect(() => {
		if (foldersQuery.data) {
			onLoaded();
		}
	}, [foldersQuery.data, onLoaded]);

	if (foldersQuery.isPending) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
					<p className="mt-4 text-muted-foreground">Pobieranie folderow z Google Drive...</p>
				</CardContent>
			</Card>
		);
	}

	if (foldersQuery.isError) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">{foldersQuery.error.message}</p>
					<Button variant="outline" className="mt-4" onClick={() => foldersQuery.refetch()}>
						Sprobuj ponownie
					</Button>
				</CardContent>
			</Card>
		);
	}

	return null;
}
