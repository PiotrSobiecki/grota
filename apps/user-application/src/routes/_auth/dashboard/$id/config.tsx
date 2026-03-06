import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bell, Loader2 } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDeploymentById } from "@/core/functions/deployments/direct";
import { sendNotifications } from "@/core/functions/notifications/binding";

interface ConfigAccount {
	email: string;
	name: string;
	oauth_refresh_token: string | null;
	folders: Array<{ id: string; name: string; category: string }>;
}

interface ConfigPreview {
	deployment_id: string;
	client_name: string;
	domain: string;
	created_at: string;
	workspace: { oauth_refresh_token: string } | null;
	accounts: ConfigAccount[];
	b2: unknown;
	server: unknown;
}

interface ExportResult {
	r2Key: string;
	status: string;
}

export const Route = createFileRoute("/_auth/dashboard/$id/config")({
	component: ConfigPage,
});

function ConfigPage() {
	const { id: deploymentId } = Route.useParams();
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
	const apiToken = import.meta.env.VITE_API_TOKEN;
	const [exportResult, setExportResult] = useState<ExportResult | null>(null);

	const deploymentQuery = useQuery({
		queryKey: ["deployment", deploymentId],
		queryFn: () => getDeploymentById({ data: { id: deploymentId } }),
	});

	const previewQuery = useQuery({
		queryKey: ["config-preview", deploymentId],
		queryFn: async () => {
			const response = await fetch(`${dataServiceUrl}/config/preview/${deploymentId}`, {
				headers: { Authorization: `Bearer ${apiToken}` },
			});
			if (!response.ok) throw new Error("Nie udalo sie pobrac podgladu");
			return response.json() as Promise<ConfigPreview>;
		},
	});

	const exportMutation = useMutation({
		mutationFn: async () => {
			const response = await fetch(`${dataServiceUrl}/config/export/${deploymentId}`, {
				method: "POST",
				headers: { Authorization: `Bearer ${apiToken}` },
			});
			if (!response.ok) {
				const body = (await response.json()) as { error?: string };
				throw new Error(body.error ?? "Eksport nie powiodl sie");
			}
			return response.json() as Promise<ExportResult>;
		},
		onSuccess: (data) => setExportResult(data),
	});

	if (previewQuery.isPending) {
		return (
			<div className="flex items-center gap-2 py-12 text-muted-foreground justify-center">
				<Loader2 className="h-5 w-5 animate-spin" />
				Ladowanie podgladu konfiguracji...
			</div>
		);
	}

	if (previewQuery.isError) {
		return (
			<div className="space-y-6">
				<BackHeader />
				<Alert variant="destructive">
					<p className="text-sm">{previewQuery.error.message}</p>
				</Alert>
			</div>
		);
	}

	const config = previewQuery.data;
	const isActive = deploymentQuery.data?.status === "active";

	const folderCount = config.accounts.reduce(
		(sum, a) => sum + a.folders.filter((f) => f.category !== "prywatne").length,
		0,
	);

	return (
		<div className="space-y-6">
			<BackHeader />

			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Konfiguracja eksportu</h1>
				<div className="flex items-center gap-2">
					{isActive && <NotificationButton deploymentId={deploymentId} />}
					{exportResult && <Badge variant="default">Wyeksportowano</Badge>}
				</div>
			</div>

			<Alert variant="warning">
				<AlertTitle>Bezpieczenstwo tokenow</AlertTitle>
				<AlertDescription>
					Plik konfiguracyjny zawiera tokeny OAuth (refresh tokens). Tokeny sa przechowywane w
					postaci jawnej w R2 — bucket jest kontrolowany przez operatora. W razie potrzeby tokeny
					mozna cofnac w ustawieniach Google kazdego uzytkownika.
				</AlertDescription>
			</Alert>

			<Card>
				<CardHeader>
					<CardTitle>Podglad JSON</CardTitle>
				</CardHeader>
				<CardContent>
					<pre className="overflow-x-auto rounded bg-muted p-4 text-xs text-foreground">
						{JSON.stringify(config, null, 2)}
					</pre>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Podsumowanie</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<div className="text-sm text-muted-foreground">Klient: {config.client_name}</div>
					<div className="text-sm text-muted-foreground">Pracownicy: {config.accounts.length}</div>
					<div className="text-sm text-muted-foreground">
						Foldery (bez prywatnych): {folderCount}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Eksport do R2</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{exportResult ? (
						<div className="space-y-2">
							<p className="text-sm text-green-600 dark:text-green-400">
								Konfiguracja wyeksportowana pomyslnie.
							</p>
							<p className="text-sm text-muted-foreground">
								Klucz R2: <code className="text-foreground">{exportResult.r2Key}</code>
							</p>
							<p className="text-sm text-muted-foreground">
								Status wdrozenia: {exportResult.status}
							</p>
							<Button
								variant="outline"
								onClick={() => {
									setExportResult(null);
									exportMutation.reset();
								}}
							>
								Eksportuj ponownie
							</Button>
						</div>
					) : (
						<>
							{exportMutation.isError && (
								<Alert variant="destructive">
									<p className="text-sm">{exportMutation.error.message}</p>
								</Alert>
							)}
							<p className="text-sm text-muted-foreground">
								Plik zostanie zapisany w R2 jako:{" "}
								<code className="text-foreground">configs/{deploymentId}/config.json</code>
							</p>
							<Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
								{exportMutation.isPending ? "Eksportowanie..." : "Eksportuj do R2"}
							</Button>
						</>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Dostep z serwera (S3 API)</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<p className="text-sm text-muted-foreground">
						Skrypty serwerowe moga pobrac konfiguracje z R2 za pomoca S3-compatible API:
					</p>
					<pre className="overflow-x-auto rounded bg-muted p-4 text-xs text-foreground">
						{[
							"# Ustaw zmienne srodowiskowe:",
							'export R2_ACCESS_KEY_ID="..."',
							'export R2_SECRET_ACCESS_KEY="..."',
							'export R2_ENDPOINT="https://{account_id}.r2.cloudflarestorage.com"',
							"",
							"# Pobierz konfiguracje za pomoca rclone:",
							`rclone copy r2:grota-configs/configs/${deploymentId}/config.json ./`,
							"",
							"# Lub za pomoca curl + AWS Signature V4:",
							`curl "$R2_ENDPOINT/grota-configs/configs/${deploymentId}/config.json" \\`,
							'  --aws-sigv4 "aws:amz:auto:s3" \\',
							'  --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY"',
						].join("\n")}
					</pre>
				</CardContent>
			</Card>
		</div>
	);
}

interface NotificationButtonProps {
	deploymentId: string;
}

function NotificationButton({ deploymentId }: NotificationButtonProps) {
	const [open, setOpen] = useState(false);

	const notifyMutation = useMutation({
		mutationFn: () => sendNotifications({ data: { deploymentId } }),
	});

	const handleConfirm = () => {
		setOpen(false);
		notifyMutation.reset();
		notifyMutation.mutate();
	};

	return (
		<>
			{notifyMutation.isSuccess && (
				<p className="text-sm text-primary">
					Telegram: {notifyMutation.data.telegram ? "OK" : "blad"}, Email:{" "}
					{notifyMutation.data.email ? "OK" : "pominiety"}
				</p>
			)}
			{notifyMutation.isError && (
				<p className="text-sm text-destructive">{notifyMutation.error.message}</p>
			)}
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogTrigger asChild>
					<Button variant="outline" disabled={notifyMutation.isPending}>
						{notifyMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Wysylanie...
							</>
						) : (
							<>
								<Bell className="mr-2 h-4 w-4" />
								Wyslij powiadomienia
							</>
						)}
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Wyslij powiadomienia</AlertDialogTitle>
						<AlertDialogDescription>
							Telegram i email zostanal wyslane do administratora wdrozenia. Kontynuowac?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Anuluj</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirm}>Wyslij</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function BackHeader() {
	const { id } = Route.useParams();
	return (
		<div className="flex items-center gap-3">
			<Button variant="ghost" size="icon" asChild>
				<Link to="/dashboard/$id" params={{ id }}>
					<ArrowLeft className="h-4 w-4 text-foreground" />
				</Link>
			</Button>
			<h1 className="text-2xl font-bold text-foreground">Powrot do wdrozenia</h1>
		</div>
	);
}
