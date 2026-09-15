# Naturbummler: Vorbereitung und Deployment-Konfiguration

## Status

**Noch nicht deployt.** Der leere Dienst und die Domain sind angelegt; Variablenreferenzen, Docker-Build, Start und Healthcheck sind hinterlegt. Die Code-Quelle fehlt absichtlich noch. Dieser Stand ist eine getestete Vorbereitung, keine Live-Abnahme.

- Fork: `NTD-Consulting-Ventures/naturbummler-lexware-mcp`.
- Ausgangspunkt: `marselsel/Lexware-MCP-Server`, Commit `5c0247053c36aaaac0feaebdbda2dbc7e09f4a59`.
- Arbeitsbranch: `codex/naturbummler-entra-railway`.
- Lokales Cargoboard-Projekt geprüft: Entra AzureProvider, `mcp.access`,
  verschlüsselter Redis-Speicher, Claude.ai und vorhandenes Naturbummler-Logo.
- Live-Railway-Prüfung nach erneuter Anmeldung erfolgreich: Projekt `naturbummler-cargo-mcp`, Umgebung `production`, Region `europe-west4-drams3a`.
- Bestehende Dienste: `cargo-mcp`, `google-ads-mcp`, `Redis`; Cargoboard-Healthcheck und OAuth-Discovery erfolgreich.
- Der Railway-OAuth-Connector liefert Variablennamen, aber keine Werte.
- Werte von Mandant/API-Audience und die konkrete Entra-Client-Registrierung sind deshalb
  **noch nicht bestätigt**. Bestehende Dienste wurden nicht verändert.
- Auftraggeber-Präzisierung: Zugriff wie Cargoboard ohne zusätzliche Gruppen-/Rollenfilter (`ENTRA_ACCESS_POLICY=tenant`).
- Lexware-Schlüssel wird vom Auftraggeber später direkt in Railway hinterlegt.

## Vorgesehene Railway-Konfiguration

| Einstellung | Wert / noch erforderliche Feststellung |
|---|---|
| Projekt | `naturbummler-cargo-mcp`; bestätigte ID in der lokalen Deployment-Vorlage |
| Umgebung | `production`; bestätigte ID in der lokalen Deployment-Vorlage |
| Dienstname | `naturbummler-lexware-mcp` |
| Quelle | Naturbummler-Fork, freigegebener Commit; kein Upstream-Autodeploy |
| Build | Dockerfile, Node 26, gesperrter npm-Lockfile, nicht privilegierter Benutzer |
| Start | `node dist/server.js` |
| Soll-Konfiguration | `.railway/railway.ts`; benannter Teil nur für Lexware, noch nicht angewendet |
| Port | Von Railway gesetztes `PORT`; Standard 8080 |
| Healthcheck | `GET /status`, Timeout 60 Sekunden |
| Region | Soll: `europe-west4-drams3a`; aktuell voreingestellt: `sfo`, Wechsel noch offen |
| Replikate | 1 |
| Neustart | Bei Fehler, höchstens 3 Versuche |
| MCP-Adresse | `https://naturbummler-lexware-mcp-production.up.railway.app/mcp` (noch ohne Deployment) |
| Geheimnisse | `LEXWARE_API_KEY` ausschließlich als Railway-Variable |
| Zusätzlicher Speicher | Für die vorbereitete direkte Entra-Verifikation nicht erforderlich |

Der Container aktiviert `NATURBUMMLER_PROFILE=true`. Ohne vollständige Entra-
Konfiguration startet er nicht. Bei der optionalen Politik `assigned` ist zusätzlich eine Freigabeliste erforderlich. Schreibfreigaben und statische
Bearer-Alternativen werden im Profil abgewiesen. Bestehende Dienste bleiben unverändert.

## Variablen

Die Vorlage `.env.naturbummler.example` enthält keine echten Zugangsdaten.

| Variable | Herkunft / Bedeutung |
|---|---|
| `NATURBUMMLER_PROFILE` | `true` |
| `SERVER_URL` | Öffentliche HTTPS-Origin des neuen Diensts, ohne `/mcp` |
| `ENTRA_TENANT_ID` | Railway-Referenz `${{cargo-mcp.ENTRA_TENANT_ID}}` |
| `ENTRA_API_AUDIENCE` | Railway-Referenz `${{cargo-mcp.ENTRA_CLIENT_ID}}`; vor Live-Abnahme als API-Audience bestätigen |
| `ENTRA_IDENTIFIER_URI` | Optional; vorhandene API-Identifier-URI, sonst `api://<Audience>` |
| `ENTRA_SCOPE` | Railway-Referenz `${{cargo-mcp.ENTRA_SCOPE}}`; Discovery bestätigt `mcp.access` |
| `ENTRA_ACCESS_POLICY` | `tenant`, ausdrücklich wie Cargoboard ohne zusätzliche Gruppen-/Rollenfilter; optional `assigned` für engere Freigaben |
| `ENTRA_ALLOWED_ROLES` | Exakte, bereits freigegebene App-Rollenwerte, getrennt durch Komma/Leerzeichen |
| `ENTRA_ALLOWED_GROUP_IDS` | Alternativ/zusätzlich ausdrücklich freigegebene Gruppen-Objekt-IDs |
| `LEXWARE_API_KEY` | Vorhandener Lexware-Schlüssel oder separat bereitgestelltes Railway-Secret |
| `LEXWARE_READ_ONLY` | `true` |
| `LEXWARE_ENABLE_DRAFTS` | `false` |
| `LEXWARE_ENABLE_FINALIZE` | `false` |
| `LEXWARE_ENABLE_URL_UPLOAD` | `false` |
| `LEXWARE_DEBUG_LOGGING` | `false` |

Bei `assigned` genügt ein Treffer in einer konfigurierten Rollen-/Gruppenliste; ein Scope allein reicht dort nie.
Bei der gewünschten Politik `tenant` genügt ein gültiges delegiertes API-Token des eigenen Mandanten mit dem erforderlichen Scope; vorhandene Entra-Zuweisungsregeln gelten weiterhin bei der Token-Ausstellung. Gruppenüberlauf ohne nachgewiesene Mitgliedschaft
führt zur Ablehnung; es gibt keine automatische Graph-Abfrage. Eine zugewiesene
App-Rolle ist für große Gruppenbestände oft einfacher.

## Microsoft-Anmeldung und Claude.ai

### Gleiche Identität, exakt geprüfte Audience

Die Vorbereitung verwendet direkte Entra-Access-Token für die bestehende MCP-API.
Verifiziert werden RS256-Signatur, exakter mandantenspezifischer v2-Issuer, `tid`,
API-`aud`, `exp`, `iat`, `sub`, `oid`, `azp`, `ver`, delegierter `scp`; bei `assigned` zusätzlich Rolle/Gruppe.
Graph-Token, ID-Token ohne delegierten Scope und reine App-Token werden abgewiesen.
Die API-Audience darf nicht durch die Railway-URL ersetzt werden.

Cargoboard verwendet lokal einen FastMCP-OAuth-Proxy. Dessen dienstspezifische
MCP-Token sind keine Entra-Access-Token und werden hier nicht übernommen.
Dasselbe Microsoft-Konto und dieselbe geschützte MCP-API können genutzt werden;
ein beliebiger vorhandener MCP-Bearer ist dadurch nicht automatisch gültig.

### Noch vor der Live-Abnahme zu prüfen

1. Vorhandene Entra-App und Unternehmensanwendung lesen: Tenant, Identifier-URI,
   delegierter Scope, `requestedAccessTokenVersion=2`, Benutzerzuweisungen und Rollen/Gruppen.
2. Vorhandenen geeigneten OAuth-Client für Claude.ai identifizieren. Entra unterstützt
   in diesem Ablauf keine dynamische Client-Registrierung; deshalb wird kein fiktiver
   DCR-Endpunkt annonciert.
3. Bei direkter Entra-Anmeldung muss der OAuth-Client die Web-Redirect-URI
   `https://claude.ai/api/mcp/auth_callback` besitzen und die bestehende MCP-API
   delegiert anfordern dürfen. Cargoboards Server-Callback `/auth/callback` ersetzt
   diesen direkten Claude-Callback nicht.
4. In Claude.ai die registrierte OAuth-Client-ID in den erweiterten Einstellungen
   verwenden, mit Client-Secret falls die bestehende Registrierung dies benötigt.
   **Nicht ungeprüft das Cargoboard-Client-Secret weitergeben.** Ein hierfür noch
   nötiger Registrierungs- oder Credential-Wechsel muss in die endgültige
   Deployment-Konfiguration aufgenommen werden.
5. Die tatsächlichen Authorization-Requests auf PKCE, vollständigen API-Scope,
   `offline_access` und den Resource-Parameter prüfen. Falls Entra den Resource-
   Parameter auswertet, muss die MCP-URL zur bestehenden API-App gehören.
   Eine dafür nötige zusätzliche Identifier-URI oder ein OAuth-Proxy ist erst nach
   Live-Prüfung festzulegen. Die Audience-Prüfung bleibt dabei zwingend aktiv.
6. Bestehende Entra-Zuweisungen wie bei Cargoboard beibehalten. Keine zusätzliche
   Gruppen-/Rollenfreigabe für den gewünschten Pilot erforderlich; `Lexware.Read`
   dient in Tests ausschließlich der optionalen Politik `assigned`.

Die direkte Variante ist lokal geprüft. Ihre Kompatibilität mit der konkreten
Claude.ai-/Entra-Registrierung ist bis zum echten Login **offen**.

## Prüfungen

Lokal unter Node 25.6.1 ausgeführt:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm audit
```

Ergebnis: **374 Tests in 21 Dateien erfolgreich**, TypeScript-Build erfolgreich,
**0 bekannte npm-Audit-Schwachstellen** nach kompatiblen Lockfile-Aktualisierungen.

Der neue HTTP-Integrationstest startet die wirkliche Server-Anwendung, prüft
Discovery, Logo, 401/403 und verbindet einen MCP-SDK-Client über Streamable HTTP.
Er listet ausschließlich Lese-Tools, liest ein Testprofil und weist Schreib-Tools
sowie Upload-Routen ab. JWTs sind kryptografisch signierte Test-Token; JWKS und
Lexware-Antworten sind Testdaten. Das ist **kein echter Entra-/Lexware-/Claude-Test**.

Zusätzlich getestet: falscher Mandant, falsche API-Audience einschließlich Graph,
fehlender oder falscher `scp`, ungültige Signatur, fehlender Ablauf, fehlende Rollen,
Gruppenüberlauf und Schreibsperre vor dem Netzwerk einschließlich Multipart-Upload.

Ein lokaler Docker-Build wurde nicht ausgeführt, weil Docker nicht installiert ist.
Der CI-Workflow enthält einen Docker-Build sowie Build, Tests und npm-Audit.

## Abnahme nach Vervollständigung der Konfiguration

Vor Deployment die tatsächlichen Projekt-/Umgebungs-IDs, Domain, Entra-IDs,
Freigabelisten, Client-Konfiguration und den getesteten Commit vorlegen.
Erst nach der angeforderten Deployment-Freigabe die Quelle am bereits angelegten Dienst verbinden und starten.

Für einen echten Claude.ai-Test schon vor dem Railway-Deployment wird eine separat
freigegebene erreichbare HTTPS-Testinstanz mit passender Entra-Konfiguration benötigt.
Ohne einen solchen Endpunkt kann die vollständige Live-Abnahme erst nach dem
freigegebenen Deployment erfolgen; lokale Tests dürfen das nicht vortäuschen.

Live-Prüfung:

1. Claude.ai mit dem neuen MCP verbinden und Microsoft-Anmeldung vollständig abschließen.
2. Mit genehmigtem Benutzer Tools laden und `get-profile` erfolgreich ausführen.
   Im Prüfprotokoll nur Erfolg und Zeitpunkt festhalten, keine Finanz-/Profildaten oder Token.
3. Eine kleine lesende Abfrage ausführen, z. B. eine Rechnungsliste mit engem Limit.
4. Fehlender Scope muss 403 ergeben; falsche Audience/ungültiges Token muss 401 ergeben.
   Bei `assigned` zusätzlich Benutzer ohne passende Gruppen-/Rollenzuweisung testen.
5. Keine Schreib-Tools, kein Upload-Endpunkt; Token-Erneuerung nach Ablauf prüfen.
6. Deployment-, Healthcheck- und Client-Ergebnisse ohne Geheimnisse dokumentieren.

## Wartung

MIT-Lizenz und ursprüngliche Urheberschaft bleiben erhalten. Upstream-Änderungen
werden per Pull Request übernommen; Sicherheits- und Lesetests müssen dabei bestehen.
Rollback: zuvor freigegebenen Fork-Commit erneut deployen oder nur den neuen
Lexware-Dienst stoppen. Andere MCP-Dienste nicht verändern.

## Quellen

- [Microsoft: Prüfung von Token-Claims](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation)
- [Microsoft: MCP mit Entra absichern](https://learn.microsoft.com/en-us/entra/agent-id/secure-mcp-server-with-entra-id)
- [Claude: OAuth, Scopes und Callback](https://claude.com/docs/connectors/building/authentication)
- [Claude: benutzerdefinierte MCP-Connectoren](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

## Railway-Konfigurationsformat

Neue Railway-Dienste akzeptieren kein `railway.json`/`railway.toml` mehr.
Die unterstützte Soll-Konfiguration liegt deshalb unter `.railway/railway.ts`.
Sie ist typgeprüft; ein Live-IaC-Plan benötigt noch eine angemeldete CLI.
`partial` begrenzt die Verwaltung auf diesen Dienst im separaten Repository.
Ein Apply verbindet die Quelle und ist deshalb Teil des noch nicht freigegebenen Deployments.

[Railway: Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)
