import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
}

interface SharedDriveOption {
	id: string;
	name: string;
}

interface FolderWithDrive extends DriveFolder {
	selectedSharedDriveId: string | null;
}

function EmployeeFlow() {
	const { token } = Route.useParams();
	const { step, oauth, employeeId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
	const [folders, setFolders] = useState<FolderWithDrive[]>([]);
	const [sharedDrives, setSharedDrives] = useState<SharedDriveOption[]>([]);

	const effectiveStep = step >= 2 && !employeeId ? 1 : step;

	// Hydrate folders from Drive if navigated directly to step 3+
	const foldersHydration = useQuery({
		queryKey: ["drive-folders", employeeId],
		queryFn: async () => {
			const response = await fetch(`${dataServiceUrl}/folders/drive/${employeeId}`);
			if (!response.ok) throw new Error("Nie udalo sie pobrac folderow");
			return response.json() as Promise<{ folders: DriveFolder[] }>;
		},
		enabled: !!employeeId && effectiveStep >= 3 && folders.length === 0,
	});

	useEffect(() => {
		if (foldersHydration.data && folders.length === 0) {
			setFolders(
				foldersHydration.data.folders.map((f) => ({
					...f,
					selectedSharedDriveId: null,
				})),
			);
		}
	}, [foldersHydration.data, folders.length]);

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Grota -- Wybor folderow</h1>

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
						onNext={(resolvedEmployeeId, drives) => {
							setSharedDrives(drives);
							navigate({ search: { step: 2, employeeId: resolvedEmployeeId } });
						}}
					/>
				)}
				{effectiveStep === 2 && employeeId && (
					<FolderListStep
						employeeId={employeeId}
						onLoaded={(driveFolders) => {
							const withDrives: FolderWithDrive[] = driveFolders.map((f) => ({
								...f,
								selectedSharedDriveId: null,
							}));
							setFolders(withDrives);
							navigate({
								search: (prev) => ({
									step: 3,
									employeeId: prev.employeeId,
								}),
							});
						}}
					/>
				)}
				{effectiveStep === 3 && employeeId && (
					<DriveAssignmentStep
						folders={folders}
						sharedDrives={sharedDrives}
						onFoldersUpdated={setFolders}
						onNext={() => {
							navigate({
								search: (prev) => ({
									step: 4,
									employeeId: prev.employeeId,
								}),
							});
						}}
					/>
				)}
				{effectiveStep === 4 && employeeId && (
					<ConfirmStep employeeId={employeeId} folders={folders} sharedDrives={sharedDrives} />
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
						<li>Nazwy folderow najwyzszego poziomu</li>
					</ul>
					<p className="font-medium text-foreground">Czego NIE zobaczy:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Tresci plikow</li>
						<li>Plikow wewnatrz folderow</li>
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

function FolderListStep({
	employeeId,
	onLoaded,
}: {
	employeeId: string;
	onLoaded: (folders: DriveFolder[]) => void;
}) {
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
	const onLoadedRef = useRef(onLoaded);
	onLoadedRef.current = onLoaded;

	const foldersQuery = useQuery({
		queryKey: ["drive-folders", employeeId],
		queryFn: async () => {
			const response = await fetch(`${dataServiceUrl}/folders/drive/${employeeId}`);
			if (!response.ok) throw new Error("Nie udalo sie pobrac folderow");
			return response.json() as Promise<{ folders: DriveFolder[] }>;
		},
	});

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

	if (foldersQuery.data) {
		const count = foldersQuery.data.folders.length;

		if (count === 0) {
			return (
				<Card>
					<CardContent className="py-12 text-center">
						<AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400 mx-auto" />
						<p className="mt-4 text-foreground font-medium">Nie znaleziono folderow</p>
						<Button variant="outline" className="mt-4" onClick={() => foldersQuery.refetch()}>
							Sprobuj ponownie
						</Button>
					</CardContent>
				</Card>
			);
		}

		return (
			<Card>
				<CardContent className="py-12 text-center">
					<CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400 mx-auto" />
					<p className="mt-4 text-foreground font-medium">
						Znaleziono {count} {count === 1 ? "folder" : "folderow"}
					</p>
					<Button className="mt-4" onClick={() => onLoadedRef.current(foldersQuery.data.folders)}>
						Dalej
					</Button>
				</CardContent>
			</Card>
		);
	}

	return null;
}

function DriveAssignmentStep({
	folders,
	sharedDrives,
	onFoldersUpdated,
	onNext,
}: {
	folders: FolderWithDrive[];
	sharedDrives: SharedDriveOption[];
	onFoldersUpdated: (folders: FolderWithDrive[]) => void;
	onNext: () => void;
}) {
	const handleDriveChange = (folderId: string, driveId: string) => {
		const updated = folders.map((f) =>
			f.id === folderId ? { ...f, selectedSharedDriveId: driveId === "" ? null : driveId } : f,
		);
		onFoldersUpdated(updated);
	};

	const assignedCount = folders.filter((f) => f.selectedSharedDriveId !== null).length;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 3: Przypisz foldery do dyskow</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Dla kazdego folderu wybierz dysk wspoldzielony. Foldery oznaczone jako "Pomijane" nie beda
					backupowane.
				</p>

				<div className="space-y-3">
					{folders.map((folder) => (
						<div
							key={folder.id}
							className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-foreground">{folder.name}</p>
							</div>
							<select
								value={folder.selectedSharedDriveId ?? ""}
								onChange={(e) => handleDriveChange(folder.id, e.target.value)}
								className="rounded border border-input bg-background px-3 py-1.5 text-sm text-foreground"
							>
								<option value="">Pomijane (prywatne)</option>
								{sharedDrives.map((drive) => (
									<option key={drive.id} value={drive.id}>
										{drive.name}
									</option>
								))}
							</select>
						</div>
					))}
				</div>

				<div className="flex items-center justify-between pt-4">
					<p className="text-sm text-muted-foreground">
						{assignedCount} z {folders.length} folderow do backupu
					</p>
					<Button onClick={onNext}>Dalej</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ConfirmStep({
	employeeId,
	folders,
	sharedDrives,
}: {
	employeeId: string;
	folders: FolderWithDrive[];
	sharedDrives: SharedDriveOption[];
}) {
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
	const [saved, setSaved] = useState(false);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const allSelections = folders.map((f) => ({
				folderId: f.id,
				folderName: f.name,
				sharedDriveId: f.selectedSharedDriveId,
			}));

			const response = await fetch(`${dataServiceUrl}/folders/selections`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					employeeId,
					selections: allSelections,
				}),
			});

			if (!response.ok) throw new Error("Nie udalo sie zapisac wyboru");
			return response.json();
		},
		onSuccess: () => {
			setSaved(true);
			toast.success("Wybor zapisany");
		},
		onError: (error) => toast.error(error.message),
	});

	// Group folders by drive name
	const driveIdToName = new Map(sharedDrives.map((d) => [d.id, d.name]));
	const groupedByDrive = new Map<string, number>();
	let skippedCount = 0;

	for (const folder of folders) {
		if (folder.selectedSharedDriveId === null) {
			skippedCount++;
		} else {
			const driveName = driveIdToName.get(folder.selectedSharedDriveId) ?? "Nieznany";
			groupedByDrive.set(driveName, (groupedByDrive.get(driveName) ?? 0) + 1);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 4: Potwierdzenie</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{saved ? (
					<div className="space-y-4 text-center">
						<p className="text-lg font-medium text-green-600 dark:text-green-400">
							Wybor zapisany pomyslnie.
						</p>
						<p className="text-muted-foreground">Dziekujemy! Mozesz zamknac ta strone.</p>
					</div>
				) : (
					<>
						<p className="text-muted-foreground">Sprawdz podsumowanie przed zatwierdzeniem:</p>

						<div className="grid gap-2 sm:grid-cols-2">
							{[...groupedByDrive.entries()].map(([driveName, count]) => (
								<div key={driveName} className="rounded-lg border border-border p-3">
									<p className="font-medium text-foreground">{driveName}</p>
									<p className="text-sm text-muted-foreground">
										{count} {count === 1 ? "folder" : "folderow"}
									</p>
								</div>
							))}
							{skippedCount > 0 && (
								<div className="rounded-lg border border-border p-3">
									<p className="font-medium text-foreground">Pomijane (prywatne)</p>
									<p className="text-sm text-muted-foreground">
										{skippedCount} {skippedCount === 1 ? "folder" : "folderow"}
									</p>
								</div>
							)}
						</div>

						{saveMutation.isError && (
							<p className="text-sm text-destructive">{saveMutation.error.message}</p>
						)}

						<Button
							className="w-full"
							onClick={() => saveMutation.mutate()}
							disabled={saveMutation.isPending}
						>
							{saveMutation.isPending ? "Zapisywanie..." : "Zatwierdz wybor"}
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	);
}
