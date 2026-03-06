import type { DeploymentResponse } from "@repo/data-ops/deployment";
import { DeploymentStatusSchema } from "@repo/data-ops/deployment";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { z } from "zod";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { deleteDeploymentById, listDeployments } from "@/core/functions/deployments/direct";

const PAGE_SIZE = 20;

const searchSchema = z.object({
	page: z.coerce.number().min(1).default(1),
	status: DeploymentStatusSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/_auth/dashboard/")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => search,
	loader: ({ deps: { page, status } }) => {
		const offset = (page - 1) * PAGE_SIZE;
		return listDeployments({ data: { limit: PAGE_SIZE, offset, status } });
	},
	component: DeploymentListPage,
});

const STATUS_OPTIONS = [
	{ value: "all", label: "Wszystkie" },
	{ value: "draft", label: "Szkic" },
	{ value: "onboarding", label: "Onboarding" },
	{ value: "employees_pending", label: "Oczekuje na pracownikow" },
	{ value: "ready", label: "Gotowe" },
	{ value: "active", label: "Aktywne" },
] as const;

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

function StatusFilter() {
	const { status } = Route.useSearch();
	const navigate = useNavigate();

	return (
		<Select
			value={status ?? "all"}
			onValueChange={(val: string) => {
				const parsed = DeploymentStatusSchema.safeParse(val);
				navigate({
					from: Route.fullPath,
					search: () => ({
						page: 1,
						status: parsed.success ? parsed.data : undefined,
					}),
				});
			}}
		>
			<SelectTrigger className="w-48">
				<SelectValue placeholder="Status" />
			</SelectTrigger>
			<SelectContent>
				{STATUS_OPTIONS.map((opt) => (
					<SelectItem key={opt.value} value={opt.value}>
						{opt.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

interface PaginationProps {
	total: number;
	limit: number;
}

function Pagination({ total, limit }: PaginationProps) {
	const { page, status } = Route.useSearch();
	const navigate = useNavigate();
	const totalPages = Math.max(1, Math.ceil(total / limit));

	const goTo = (p: number) =>
		navigate({
			from: Route.fullPath,
			search: () => ({
				status,
				page: p,
			}),
		});

	return (
		<div className="flex items-center justify-between">
			<span className="text-sm text-muted-foreground">
				Strona {page} z {totalPages}
			</span>
			<div className="flex gap-2">
				<Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
					Poprzednia
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={page >= totalPages}
					onClick={() => goTo(page + 1)}
				>
					Nastepna
				</Button>
			</div>
		</div>
	);
}

function DeleteDeploymentButton({ id, clientName }: { id: string; clientName: string }) {
	const router = useRouter();
	const mutation = useMutation({
		mutationFn: () => deleteDeploymentById({ data: { id } }),
		onSuccess: () => router.invalidate(),
	});

	const handleClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};

	return (
		<div onClick={handleClick}>
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="text-muted-foreground hover:text-destructive"
					>
						<Trash2 className="size-4" />
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Usunac wdrozenie?</AlertDialogTitle>
						<AlertDialogDescription>
							Wdrozenie &ldquo;{clientName}&rdquo; zostanie trwale usuniete. Tej operacji nie mozna
							cofnac.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Anuluj</AlertDialogCancel>
						<AlertDialogAction onClick={() => mutation.mutate()} disabled={mutation.isPending}>
							{mutation.isPending ? "Usuwanie..." : "Usun"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function DeploymentListPage() {
	const { data, pagination } = Route.useLoaderData();

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold text-foreground">Wdrozenia</h1>
				<Button asChild>
					<Link to="/dashboard/new">Nowe wdrozenie</Link>
				</Button>
			</div>

			<StatusFilter />

			{data.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<p className="text-muted-foreground">Brak wdrozen pasujacych do filtra.</p>
					</CardContent>
				</Card>
			) : (
				<>
					<div className="grid gap-4">
						{data.map((deployment: DeploymentResponse) => (
							<Link
								key={deployment.id}
								to="/dashboard/$id"
								params={{ id: deployment.id }}
								className="block"
							>
								<Card className="hover:border-primary transition-colors">
									<CardHeader className="flex flex-row items-center justify-between">
										<div className="flex items-center gap-2">
											<CardTitle className="text-lg">{deployment.clientName}</CardTitle>
											<Badge variant={STATUS_VARIANTS[deployment.status] ?? "outline"}>
												{STATUS_LABELS[deployment.status] ?? deployment.status}
											</Badge>
										</div>
										<DeleteDeploymentButton id={deployment.id} clientName={deployment.clientName} />
									</CardHeader>
									<CardContent>
										<p className="text-sm text-muted-foreground">{deployment.domain}</p>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
					<Pagination total={pagination.total} limit={pagination.limit} />
				</>
			)}
		</div>
	);
}
