import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDeploymentById } from "@/core/functions/deployments/direct";

export const Route = createFileRoute("/_auth/dashboard/$id")({
	loader: ({ params }) => getDeploymentById({ data: { id: params.id } }),
	component: DeploymentDetailPage,
});

const STATUS_LABELS: Record<string, string> = {
	draft: "Szkic",
	onboarding: "Onboarding",
	employees_pending: "Oczekuje na pracownikow",
	ready: "Gotowe",
	active: "Aktywne",
};

function DeploymentDetailPage() {
	const deployment = Route.useLoaderData();

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" asChild>
						<Link to="/dashboard">
							<ArrowLeft className="h-4 w-4 text-foreground" />
						</Link>
					</Button>
					<h1 className="text-2xl font-bold text-foreground">{deployment.clientName}</h1>
				</div>
				<Badge>{STATUS_LABELS[deployment.status] ?? deployment.status}</Badge>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Dane klienta</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						<div>
							<span className="text-sm text-muted-foreground">Domena: </span>
							<span className="text-foreground">{deployment.domain}</span>
						</div>
						{deployment.adminEmail && (
							<div>
								<span className="text-sm text-muted-foreground">Admin: </span>
								<span className="text-foreground">
									{deployment.adminName ?? ""} ({deployment.adminEmail})
								</span>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Status wdrozenia</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground">
							Utworzone: {new Date(deployment.createdAt).toLocaleDateString("pl-PL")}
						</p>
						{/* Employee progress and magic link generation added in doc 003 */}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
