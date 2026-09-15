# Railway-Vorbereitung

Die Datei `railway.ts` beschreibt den Sollzustand des Lexware-Diensts im bestehenden
Projekt `naturbummler-cargo-mcp`, Umgebung `production`.

Sie ist ein benannter Teil (`partial`), weil Cargoboard und Google Ads in eigenen
Repositories verwaltet werden. Diesen Namen nicht ändern. Der Plan darf keine
Löschungen oder Änderungen an Cargoboard, Google Ads oder Redis enthalten.

Die Datei ist typgeprüft, aber noch nicht mit einer angemeldeten Railway-CLI geplant
oder angewendet. Kein automatischer Apply-Workflow ist eingerichtet.

Vor der Freigabe:

1. `LEXWARE_API_KEY` direkt im bestehenden leeren Lexware-Dienst hinterlegen.
2. Entra-/Claude-Client-Konfiguration abschließen.
3. Railway CLI >= 5.42.1 anmelden und mit dem bestehenden Projekt/production verbinden.
4. `railway config plan` ausführen und den vollständigen Plan prüfen.
5. Nutzerfreigabe einholen. `railway config apply` kann durch die Quellenverknüpfung
   ein Deployment auslösen und darf deshalb nicht vorher ausgeführt werden.

Der Schlüssel wird durch `preserve()` auf Railway gehalten. Keine echten Secret-
Werte in die Datei schreiben. Die öffentliche Domain ist bereits angelegt und wird
nicht durch IaC verwaltet. Der Regionswechsel von SFO nach Europe West und die
GitHub-Quellenverknüpfung sind noch nicht angewendet.
