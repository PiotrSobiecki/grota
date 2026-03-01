import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Copy, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDeploymentById } from "@/core/functions/deployments/direct";
import { generateAdminMagicLink } from "@/core/functions/magic-links/binding";

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
	const router = useRouter();

	const magicLinkMutation = useMutation({
		mutationFn: () => generateAdminMagicLink({ data: { deploymentId: deployment.id } }),
		onSuccess: () => {
			// Invalidate the router to reload deployment (status change to onboarding)
			router.invalidate();
		},
	});

	const handleCopyLink = async () => {
		const url = magicLinkMutation.data?.url;
		if (!url) return;
		const fullUrl = `${window.location.origin}${url}`;
		await navigator.clipboard.writeText(fullUrl);
	};

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
					<CardContent className="space-y-4">
						<p className="text-muted-foreground">
							Utworzone: {new Date(deployment.createdAt).toLocaleDateString("pl-PL")}
						</p>

						{/* Magic link generation */}
						{deployment.adminEmail && (
							<div className="space-y-3">
								{deployment.status !== "draft" && !magicLinkMutation.data?.url && (
									<p className="text-sm text-muted-foreground">
										Link onboardingowy zostal juz wyslany na {deployment.adminEmail}
									</p>
								)}

								<Button
									onClick={() => magicLinkMutation.mutate()}
									disabled={magicLinkMutation.isPending}
									variant={deployment.status !== "draft" ? "outline" : "default"}
								>
									{magicLinkMutation.isPending ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Generowanie...
										</>
									) : (
										<>
											<Send className="mr-2 h-4 w-4" />
											{deployment.status === "draft" ? "Generuj link" : "Wyslij ponownie"}
										</>
									)}
								</Button>

								{magicLinkMutation.isError && (
									<p className="text-sm text-destructive">{magicLinkMutation.error.message}</p>
								)}

								{magicLinkMutation.data?.url && (
									<div className="flex items-center gap-2 rounded-md border border-border bg-muted p-3">
										<code className="flex-1 text-sm text-foreground break-all">
											{magicLinkMutation.data.url}
										</code>
										<Button
											variant="ghost"
											size="icon"
											onClick={handleCopyLink}
											title="Kopiuj link"
										>
											<Copy className="h-4 w-4" />
										</Button>
									</div>
								)}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
