import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/employee/$token")({
	component: EmployeeFlow,
});

function EmployeeFlow() {
	const { token } = Route.useParams();
	const [currentStep, setCurrentStep] = useState(1);

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Grota — Autoryzacja Drive</h1>

				<div className="flex gap-2">
					{[1, 2, 3, 4].map((step) => (
						<div
							key={step}
							className={`h-2 flex-1 rounded ${step <= currentStep ? "bg-primary" : "bg-muted"}`}
						/>
					))}
				</div>

				{currentStep === 1 && <DriveOAuthStep token={token} onNext={() => setCurrentStep(2)} />}
				{currentStep >= 2 && (
					<Card>
						<CardContent className="py-8 text-center">
							<p className="text-muted-foreground">
								Autoryzacja zakonczona. Wybor folderow zostanie udostepniony wkrotce.
							</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}

interface DriveOAuthStepProps {
	token: string;
	onNext: () => void;
}

function DriveOAuthStep({ token, onNext }: DriveOAuthStepProps) {
	const [oauthCompleted, setOauthCompleted] = useState(false);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("oauth") === "success") {
			setOauthCompleted(true);
		}
	}, []);

	const handleAuthorize = () => {
		const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
		window.location.href = `${dataServiceUrl}/api/oauth/google/authorize?type=employee&id=${token}`;
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 1: Autoryzacja Google Drive</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
					<p className="font-medium text-foreground">Co zobaczy aplikacja:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Nazwy folderow najwyzszego poziomu</li>
					</ul>
					<p className="font-medium text-foreground">Czego NIE zobaczy:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Tresci plikow</li>
						<li>Plikow wewnatrz folderow</li>
					</ul>
					<p className="text-sm text-muted-foreground">
						Mozesz cofnac dostep w dowolnym momencie w ustawieniach Google
						(myaccount.google.com/permissions).
					</p>
				</div>

				{oauthCompleted ? (
					<div className="space-y-2">
						<p className="text-sm text-green-600 dark:text-green-400">
							Autoryzacja zakonczona pomyslnie.
						</p>
						<Button onClick={onNext}>Dalej</Button>
					</div>
				) : (
					<Button onClick={handleAuthorize}>Autoryzuj Google Drive</Button>
				)}
			</CardContent>
		</Card>
	);
}
