# Railway-Konfiguration

Die Datei `railway.ts` beschreibt den Sollzustand des Lexware-Diensts im bestehenden
Projekt `naturbummler-cargo-mcp`, Umgebung `production`.

Sie ist ein benannter Teil (`partial`), weil Cargoboard und Google Ads in eigenen
Repositories verwaltet werden. Diesen Namen nicht ändern. Der Plan darf keine
Löschungen oder Änderungen an Cargoboard, Google Ads oder Redis enthalten.

Die Live-Konfiguration wurde über Railway angewendet. Die Datei bleibt der typgeprüfte,
auf diesen Dienst begrenzte Sollzustand.

Für die OAuth-Proxy-Umstellung:

1. Bestehende Cargoboard-Entra- und Redis-Secrets ausschließlich per Railway-Referenz übernehmen.
2. In der bestehenden Entra-App die Web-Redirect-URI
   `https://naturbummler-lexware-mcp-production.up.railway.app/auth/callback` ergänzen.
3. `LEXWARE_API_KEY` direkt im Lexware-Dienst hinterlegen.
4. Nach dem Deployment Discovery, DCR, Microsoft-Anmeldung und eine Leseabfrage prüfen.

Der Schlüssel wird durch `preserve()` auf Railway gehalten. Keine echten Secret-
Werte in die Datei schreiben. Die öffentliche Domain ist bereits angelegt und wird
nicht durch IaC verwaltet. Region und GitHub-Quelle sind bereits live.
