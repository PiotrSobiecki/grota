import type { DeploymentResponse } from "@repo/data-ops/deployment";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listDeployments } from "@/core/functions/deployments/direct";

export const Route = createFileRoute("/_auth/dashboard/")({
	loader: () => listDeployments({ data: { limit: 20, offset: 0 } }),
	component: DeploymentListPage,
});

const STATUS_LABELS: Record<string, string> = {
	draft: "Szkic",
	onboarding: "Onboarding",
	employees_pending: "Oczekuje na pracownikow",
	ready: "Gotowe",
	active: "Aktywne",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
	draft: "outline",
	onboarding: "secondary",
	employees_pending: "secondary",
	ready: "default",
	active: "default",
};

function DeploymentListPage() {
	const deployments = Route.useLoaderData();

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Wdrozenia</h1>
				<Button asChild>
					<Link to="/dashboard/new">Nowe wdrozenie</Link>
				</Button>
			</div>

			{deployments.data.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<p className="text-muted-foreground">
							Brak wdrozen. Utworz nowe wdrozenie aby rozpoczac.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4">
					{deployments.data.map((deployment: DeploymentResponse) => (
						<Link
							key={deployment.id}
							to="/dashboard/$id"
							params={{ id: deployment.id }}
							className="block"
						>
							<Card className="hover:border-primary transition-colors">
								<CardHeader className="flex flex-row items-center justify-between">
									<CardTitle className="text-lg">{deployment.clientName}</CardTitle>
									<Badge variant={STATUS_VARIANTS[deployment.status] ?? "outline"}>
										{STATUS_LABELS[deployment.status] ?? deployment.status}
									</Badge>
								</CardHeader>
								<CardContent>
									<p className="text-sm text-muted-foreground">{deployment.domain}</p>
								</CardContent>
							</Card>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
