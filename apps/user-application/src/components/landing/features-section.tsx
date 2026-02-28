import { HardDrive, Shield, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
	{
		icon: Users,
		title: "Onboarding klientow",
		description:
			"Wizard krok po kroku: dane firmy, autoryzacja OAuth, lista pracownikow do migracji.",
		badge: "Onboarding",
	},
	{
		icon: HardDrive,
		title: "Backup 3-2-1",
		description:
			"Serwer lokalny + Backblaze B2, szyfrowanie AES-256. Pelna kopia dokumentow i mediow z kont Google.",
		badge: "Backup",
	},
	{
		icon: Shield,
		title: "Reorganizacja dostepu",
		description:
			"Google Groups, Shared Drives, uprawnienia - automatyczna konfiguracja srodowiska klienta.",
		badge: "Dostep",
	},
];

export function FeaturesSection() {
	return (
		<section id="features" className="pt-12 sm:pt-16 pb-24 sm:pb-32">
			<div className="mx-auto max-w-7xl px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
						Funkcje platformy
					</h2>
					<p className="mt-4 text-lg text-muted-foreground">
						Kompleksowe narzedzie do onboardingu klientow i zarzadzania dostepem Google
					</p>
				</div>

				<div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-6 sm:mt-20 lg:mx-0 lg:max-w-none lg:grid-cols-3">
					{features.map((feature) => {
						const IconComponent = feature.icon;
						return (
							<Card
								key={feature.title}
								className="group hover:shadow-xl transition-all duration-300 hover:-translate-y-1 border-primary/20"
							>
								<CardHeader>
									<div className="flex items-center justify-between mb-2">
										<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
											<IconComponent className="h-6 w-6 text-primary" />
										</div>
										<Badge variant="default" className="text-xs">
											{feature.badge}
										</Badge>
									</div>
									<CardTitle className="text-lg">{feature.title}</CardTitle>
								</CardHeader>
								<CardContent>
									<CardDescription className="text-sm leading-relaxed">
										{feature.description}
									</CardDescription>
								</CardContent>
							</Card>
						);
					})}
				</div>
			</div>
		</section>
	);
}
