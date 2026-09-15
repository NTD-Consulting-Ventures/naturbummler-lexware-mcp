# Naturbummler Lexware MCP

## Auftrag und Ablauf
Naturbummler betreibt einen gepflegten Fork von marselsel/Lexware-MCP-Server.
Mitarbeitende mit bestehender Entra-MCP-Berechtigung melden sich in Claude.ai mit der bestehenden
Microsoft-Entra-Identität an und lesen Lexware-Daten im Gespräch.
Die vorhandenen Lese-Tools bleiben erhalten; neue Schreibabläufe sind nicht Teil des Piloten.

## Sicherheitskonzept
- Bestehenden Entra-Mandanten und bestehende MCP-API-Audience verwenden.
- Signatur, exakter v2-Issuer, tid, API-aud, Ablauf, delegierter scp und
  gemäß gewünschter Zugriffspolitik optionale Gruppen/App-Rollen prüfen.
- Präzisierung des Auftraggebers: wie Cargoboard, keine zusätzliche Einschränkung;
  ENTRA_ACCESS_POLICY=tenant. Mandant, Audience und delegierter Scope bleiben verpflichtend.
- Graph- und ID-Token dürfen keinen Zugriff erteilen.
- Keine Autorisierung anhand der E-Mail-Domain.
- Lexware-Schlüssel ausschließlich serverseitig als Railway-Secret.
- Im Naturbummler-Profil nur lesende API-Aufrufe; keine Upload-Routen.
- NB-Logo aus dem vorhandenen Cargoboard-Projekt übernehmen.

## Deployment und Abnahme
Neuer Dienst in bestehendem Railway-Projekt und bestehender Umgebung.
Konkrete IDs, Entra-Zuweisungen und Client-Registrierung erst nach Live-Prüfung festlegen.
Kein Deployment vor Vorstellung der Konfiguration und Freigabe.
Lokale Positiv-/Negativtests ersetzen nicht den echten Claude.ai-Anmelde- und Lesetest.
Dieser benötigt eine erreichbare HTTPS-Adresse und den bestehenden Entra-/Railway-Zugang.

## Ist-Stand
Lokales Cargoboard verwendet FastMCP AzureProvider, mcp.access, Redis und Claude.ai.
Seine MCP-Proxy-Token sind nicht automatisch Entra-Access-Token: gleiche Anmeldung
und API-Audience sind vorgesehen; dienstfremde Proxy-Token werden nicht akzeptiert.
Railway-Zugang wiederhergestellt. Projekt naturbummler-cargo-mcp / production
mit cargo-mcp, google-ads-mcp und Redis in europe-west4-drams3a bestätigt.
Variablenwerte sind vom Connector ausgeblendet; Entra-Freigaben und Live-Login bleiben offen.

## Deployment-Freigabe
Der Auftraggeber hat das Deployment ausdrücklich freigegeben und hinterlegt den
Lexware-Schlüssel später. Bis dahin startet der Entra-geschützte Dienst, sperrt
Lexware-Aufrufe vor dem Netzwerk und meldet /ready mit 503. /status bleibt das Lebenszeichen.
