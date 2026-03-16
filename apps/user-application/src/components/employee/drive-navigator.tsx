import { useQuery } from "@tanstack/react-query";
import { ChevronRight, File, Folder, Info, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DriveItemResponse {
	id: string;
	name: string;
	mimeType: string;
	type: "folder" | "file";
	size: number | null;
}

interface SharedDriveOption {
	id: string;
	name: string;
}

export interface SelectedItem {
	id: string;
	name: string;
	mimeType: string;
	size: number | null;
	type: "folder" | "file";
	selectedSharedDriveId: string | null;
	parentFolderId: string | null;
}

interface BreadcrumbSegment {
	id: string;
	name: string;
}

interface DriveNavigatorProps {
	employeeId: string;
	dataServiceUrl: string;
	sharedDrives: SharedDriveOption[];
	selections: SelectedItem[];
	onSelectionsChange: (items: SelectedItem[]) => void;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function DriveNavigator({
	employeeId,
	dataServiceUrl,
	sharedDrives,
	selections,
	onSelectionsChange,
}: DriveNavigatorProps) {
	const [currentParentId, setCurrentParentId] = useState("root");
	const [breadcrumb, setBreadcrumb] = useState<BreadcrumbSegment[]>([]);
	const [pageToken, setPageToken] = useState<string | undefined>(undefined);
	const [accumulatedItems, setAccumulatedItems] = useState<DriveItemResponse[]>([]);

	const itemsQuery = useQuery({
		queryKey: ["drive-items", employeeId, currentParentId, pageToken],
		queryFn: async () => {
			const params = new URLSearchParams({ parentId: currentParentId });
			if (pageToken) params.set("pageToken", pageToken);
			const response = await fetch(`${dataServiceUrl}/folders/drive/${employeeId}?${params}`);
			if (!response.ok) throw new Error("Nie udalo sie pobrac elementow");
			return response.json() as Promise<{
				items: DriveItemResponse[];
				nextPageToken: string | null;
			}>;
		},
	});

	// Merge newly fetched items into accumulated list
	const allItems =
		pageToken && itemsQuery.data
			? [...accumulatedItems, ...itemsQuery.data.items]
			: (itemsQuery.data?.items ?? accumulatedItems);

	const isParentSelected = selections.some((s) => s.type === "folder" && s.id === currentParentId);

	const isSelected = useCallback(
		(itemId: string) => selections.some((s) => s.id === itemId),
		[selections],
	);

	const handleNavigateInto = (item: DriveItemResponse) => {
		setBreadcrumb((prev) => [...prev, { id: item.id, name: item.name }]);
		setCurrentParentId(item.id);
		setPageToken(undefined);
		setAccumulatedItems([]);
	};

	const handleBreadcrumbClick = (index: number) => {
		if (index < 0) {
			setCurrentParentId("root");
			setBreadcrumb([]);
		} else {
			const segment = breadcrumb[index];
			if (!segment) return;
			setCurrentParentId(segment.id);
			setBreadcrumb((prev) => prev.slice(0, index + 1));
		}
		setPageToken(undefined);
		setAccumulatedItems([]);
	};

	const handleToggleItem = (item: DriveItemResponse) => {
		if (isSelected(item.id)) {
			onSelectionsChange(selections.filter((s) => s.id !== item.id));
			return;
		}

		const newItem: SelectedItem = {
			id: item.id,
			name: item.name,
			mimeType: item.mimeType,
			size: item.size,
			type: item.type,
			selectedSharedDriveId: null,
			parentFolderId: currentParentId === "root" ? null : currentParentId,
		};

		if (item.type === "folder") {
			// Auto-remove direct children of this folder
			const filtered = selections.filter((s) => s.parentFolderId !== item.id);
			onSelectionsChange([...filtered, newItem]);
		} else {
			onSelectionsChange([...selections, newItem]);
		}
	};

	const handleDriveChange = (itemId: string, driveId: string) => {
		onSelectionsChange(
			selections.map((s) =>
				s.id === itemId ? { ...s, selectedSharedDriveId: driveId === "" ? null : driveId } : s,
			),
		);
	};

	const handleLoadMore = () => {
		if (itemsQuery.data?.nextPageToken) {
			setAccumulatedItems(allItems);
			setPageToken(itemsQuery.data.nextPageToken);
		}
	};

	const assignedCount = selections.filter((s) => s.selectedSharedDriveId !== null).length;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 2: Przegladaj i wybierz</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Breadcrumb */}
				<nav className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
					<button
						type="button"
						onClick={() => handleBreadcrumbClick(-1)}
						className="hover:text-foreground font-medium"
					>
						Moj dysk
					</button>
					{breadcrumb.map((segment, i) => (
						<span key={segment.id} className="flex items-center gap-1">
							<ChevronRight className="size-3" />
							<button
								type="button"
								onClick={() => handleBreadcrumbClick(i)}
								className="hover:text-foreground font-medium"
							>
								{segment.name}
							</button>
						</span>
					))}
				</nav>

				{/* Parent-selected banner */}
				{isParentSelected && (
					<div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
						<Info className="size-4 shrink-0" />
						<span>Ten folder jest juz wybrany -- wszystkie elementy sa uwzglednione</span>
					</div>
				)}

				{/* Items list */}
				{itemsQuery.isPending && accumulatedItems.length === 0 ? (
					<div className="py-12 text-center">
						<Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
						<p className="mt-4 text-muted-foreground">Ladowanie...</p>
					</div>
				) : itemsQuery.isError ? (
					<div className="py-8 text-center">
						<p className="text-destructive">{itemsQuery.error.message}</p>
						<Button variant="outline" className="mt-4" onClick={() => itemsQuery.refetch()}>
							Sprobuj ponownie
						</Button>
					</div>
				) : (
					<div className="space-y-1">
						{allItems.map((item) => {
							const checked = isSelected(item.id);
							const disabled = isParentSelected;

							return (
								<div
									key={item.id}
									className={`flex items-center gap-3 rounded-lg border border-border p-2.5 ${
										disabled ? "opacity-50" : ""
									}`}
								>
									<input
										type="checkbox"
										checked={checked}
										disabled={disabled}
										onChange={() => handleToggleItem(item)}
										className="size-4 shrink-0 accent-primary"
									/>

									{item.type === "folder" ? (
										<button
											type="button"
											onClick={() => handleNavigateInto(item)}
											className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-primary"
										>
											<Folder className="size-4 shrink-0 text-amber-500" />
											<span className="truncate font-medium text-foreground">{item.name}</span>
										</button>
									) : (
										<div className="flex items-center gap-2 min-w-0 flex-1">
											<File className="size-4 shrink-0 text-muted-foreground" />
											<span className="truncate text-foreground">{item.name}</span>
										</div>
									)}

									{item.size !== null && (
										<span className="text-xs text-muted-foreground whitespace-nowrap">
											{formatSize(item.size)}
										</span>
									)}

									{checked && !disabled && (
										<select
											value={selections.find((s) => s.id === item.id)?.selectedSharedDriveId ?? ""}
											onChange={(e) => handleDriveChange(item.id, e.target.value)}
											className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground min-w-[120px]"
										>
											<option value="">Pomijane</option>
											{sharedDrives.map((drive) => (
												<option key={drive.id} value={drive.id}>
													{drive.name}
												</option>
											))}
										</select>
									)}
								</div>
							);
						})}

						{allItems.length === 0 && (
							<p className="py-8 text-center text-muted-foreground">
								Brak elementow w tym folderze
							</p>
						)}
					</div>
				)}

				{/* Load more */}
				{itemsQuery.data?.nextPageToken && (
					<div className="text-center">
						<Button
							variant="outline"
							size="sm"
							onClick={handleLoadMore}
							disabled={itemsQuery.isPending}
						>
							{itemsQuery.isPending ? "Ladowanie..." : "Zaladuj wiecej"}
						</Button>
					</div>
				)}

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-border pt-4">
					<p className="text-sm text-muted-foreground">
						{selections.length} wybranych, {assignedCount} przypisanych do dyskow
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
