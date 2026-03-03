import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export const Route = createFileRoute("/_auth/dashboard/$id/config")({
	component: ConfigPage,
});

function ConfigPage() {
	const { id: deploymentId } = Route.useParams();
	const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
	const apiToken = import.meta.env.VITE_API_TOKEN;

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

	const folderCount = config.accounts.reduce(
		(sum, a) => sum + a.folders.filter((f) => f.category !== "prywatne").length,
		0,
	);

	return (
		<div className="space-y-6">
			<BackHeader />

			<h1 className="text-2xl font-bold text-foreground">Konfiguracja eksportu</h1>

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
		</div>
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
