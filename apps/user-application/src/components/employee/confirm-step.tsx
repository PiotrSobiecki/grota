import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SelectedItem } from "./drive-navigator";

interface SharedDriveOption {
	id: string;
	name: string;
}

interface ConfirmStepProps {
	employeeId: string;
	selections: SelectedItem[];
	sharedDrives: SharedDriveOption[];
}

export function ConfirmStep({ employeeId, selections, sharedDrives }: ConfirmStepProps) {
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
	const [saved, setSaved] = useState(false);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const allSelections = selections.map((s) => ({
				itemId: s.id,
				itemName: s.name,
				itemType: s.type,
				parentFolderId: s.parentFolderId,
				mimeType: s.mimeType,
				sharedDriveId: s.selectedSharedDriveId,
			}));

			const response = await fetch(`${dataServiceUrl}/folders/selections`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ employeeId, selections: allSelections }),
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

	const driveIdToName = new Map(sharedDrives.map((d) => [d.id, d.name]));
	const groupedByDrive = new Map<string, number>();
	let skippedCount = 0;

	for (const item of selections) {
		if (item.selectedSharedDriveId === null) {
			skippedCount++;
		} else {
			const driveName = driveIdToName.get(item.selectedSharedDriveId) ?? "Nieznany";
			groupedByDrive.set(driveName, (groupedByDrive.get(driveName) ?? 0) + 1);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 3: Potwierdzenie</CardTitle>
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
										{count} {count === 1 ? "element" : "elementow"}
									</p>
								</div>
							))}
							{skippedCount > 0 && (
								<div className="rounded-lg border border-border p-3">
									<p className="font-medium text-foreground">Pomijane (prywatne)</p>
									<p className="text-sm text-muted-foreground">
										{skippedCount} {skippedCount === 1 ? "element" : "elementow"}
									</p>
								</div>
							)}
						</div>

						{selections.length === 0 && (
							<p className="text-sm text-muted-foreground">
								Nie wybrano zadnych elementow. Kliknij "Zatwierdz" aby potwierdzic.
							</p>
						)}

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
