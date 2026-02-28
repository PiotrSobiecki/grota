export function Footer() {
	return (
		<footer className="border-t bg-background">
			<div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
				<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
					<div>
						<p className="text-sm font-semibold text-foreground">Grota</p>
						<p className="text-xs text-muted-foreground mt-1">
							Google Reorganize, Onboard, Transfer, Archive
						</p>
					</div>
					<p className="text-xs text-muted-foreground">
						&copy; {new Date().getFullYear()} Auditmos. Wszelkie prawa zastrzezone.
					</p>
				</div>
			</div>
		</footer>
	);
}
