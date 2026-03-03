import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Copy, Info, Loader2, Mail, Send, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getDeploymentById } from "@/core/functions/deployments/direct";
import {
	getEmployeesByDeployment,
	sendEmployeeMagicLinks,
} from "@/core/functions/employees/binding";
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

const OAUTH_STATUS_LABELS: Record<
	string,
	{ label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
	pending: { label: "Oczekuje", variant: "secondary" },
	authorized: { label: "Autoryzowany", variant: "default" },
	failed: { label: "Blad", variant: "destructive" },
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

	const showEmployeeSection = deployment.status !== "draft" && deployment.status !== "onboarding";

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

				<MagicLinkCard
					deployment={deployment}
					magicLinkMutation={magicLinkMutation}
					onCopyLink={handleCopyLink}
				/>
			</div>

			{showEmployeeSection && <EmployeeSection deploymentId={deployment.id} />}
		</div>
	);
}

interface MagicLinkCardProps {
	deployment: {
		adminEmail: string | null;
		status: string;
		createdAt: string | Date;
	};
	magicLinkMutation: ReturnType<typeof useMutation<{ token: string; url: string }, Error, void>>;
	onCopyLink: () => void;
}

function MagicLinkCard({ deployment, magicLinkMutation, onCopyLink }: MagicLinkCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Status wdrozenia</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Utworzone: {new Date(deployment.createdAt).toLocaleDateString("pl-PL")}
				</p>

				{deployment.adminEmail && (
					<div className="space-y-3">
						{deployment.status !== "draft" && !magicLinkMutation.data?.url && (
							<p className="text-sm text-muted-foreground">
								Link onboardingowy zostal juz wyslany na {deployment.adminEmail}
							</p>
						)}

						<div className="flex items-center gap-2">
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
										{deployment.status === "draft" ? "Generuj i wyslij link" : "Wyslij ponownie"}
									</>
								)}
							</Button>
							<Tooltip>
								<TooltipTrigger asChild>
									<Info className="h-4 w-4 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent>
									Wygenerowany link do uzupelnienia danych firmowych zostanie wyslany na adres
									administratora tego wdrozenia.
								</TooltipContent>
							</Tooltip>
						</div>

						{magicLinkMutation.isError && (
							<p className="text-sm text-destructive">{magicLinkMutation.error.message}</p>
						)}

						{magicLinkMutation.data?.url && (
							<div className="flex items-center gap-2 rounded-md border border-border bg-muted p-3">
								<code className="flex-1 text-sm text-foreground break-all">
									{magicLinkMutation.data.url}
								</code>
								<Button variant="ghost" size="icon" onClick={onCopyLink} title="Kopiuj link">
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function EmployeeSection({ deploymentId }: { deploymentId: string }) {
	const employeesQuery = useQuery({
		queryKey: ["employees", deploymentId],
		queryFn: () => getEmployeesByDeployment({ data: { deploymentId } }),
	});

	const sendLinksMutation = useMutation({
		mutationFn: () => sendEmployeeMagicLinks({ data: { deploymentId } }),
	});

	const employees = employeesQuery.data?.data ?? [];
	const employeeTotal = employeesQuery.data?.total ?? 0;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2">
						<Users className="h-5 w-5" />
						Pracownicy
						{employeeTotal > 0 && (
							<span className="text-sm font-normal text-muted-foreground">
								({employeeTotal} pracownikow)
							</span>
						)}
					</CardTitle>
					<Button
						variant="outline"
						onClick={() => sendLinksMutation.mutate()}
						disabled={sendLinksMutation.isPending || employeeTotal === 0}
					>
						{sendLinksMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Wysylanie...
							</>
						) : (
							<>
								<Mail className="mr-2 h-4 w-4" />
								Wyslij linki pracownikom
							</>
						)}
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{sendLinksMutation.isError && (
					<p className="mb-3 text-sm text-destructive">{sendLinksMutation.error.message}</p>
				)}

				{sendLinksMutation.isSuccess && (
					<p className="mb-3 text-sm text-primary">
						Wyslano linki do {sendLinksMutation.data.sent} pracownikow.
					</p>
				)}

				<EmployeeList employees={employees} isPending={employeesQuery.isPending} />
			</CardContent>
		</Card>
	);
}

interface EmployeeListItem {
	id: string;
	name: string;
	email: string;
	oauthStatus: string;
}

function EmployeeList({
	employees,
	isPending,
}: {
	employees: EmployeeListItem[];
	isPending: boolean;
}) {
	if (isPending) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				Ladowanie pracownikow...
			</div>
		);
	}

	if (employees.length === 0) {
		return <p className="text-muted-foreground">Brak pracownikow.</p>;
	}

	return (
		<div className="space-y-2">
			{employees.map((employee) => {
				const statusInfo = OAUTH_STATUS_LABELS[employee.oauthStatus] ?? {
					label: employee.oauthStatus,
					variant: "outline" as const,
				};
				return (
					<div
						key={employee.id}
						className="flex items-center justify-between rounded-md border border-border p-3"
					>
						<div>
							<p className="text-sm font-medium text-foreground">{employee.name}</p>
							<p className="text-xs text-muted-foreground">{employee.email}</p>
						</div>
						<Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
					</div>
				);
			})}
		</div>
	);
}
