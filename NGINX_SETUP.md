# Nginx Proxy Manager Setup

## Lokaler Zugriff

Kein Benutzername, kein Passwort. Der Server ist direkt über die LAN-IP erreichbar:

```
http://<Windows-PC-IP>:58427
```

## Internet-Zugriff über NPM

### Zwei Proxy Hosts anlegen

| Feld | Admin | Cloud |
|------|-------|-------|
| Domain | `admin.domain.de` | `cloud.domain.de` |
| Scheme | `http` | `http` |
| Forward Hostname/IP | `<Windows-PC-IP>` | `<Windows-PC-IP>` |
| Forward Port | `58427` | `58427` |
| Websockets Support | ✓ | ✓ |

### SSL (beide Hosts)

- Let's Encrypt Zertifikat ausstellen
- Force SSL ✓

### Access Lists

Unter **Access Lists → neue Liste** für jeden Host:

| Tab | Einstellung |
|-----|-------------|
| Satisfy | Any |
| Users | Benutzername + Passwort des jeweiligen Nutzers |
| Access Allow | `192.168.0.0/16` (LAN-Subnetz) |

> `Satisfy Any`: LAN-Zugriff ohne Auth, externer Zugriff erfordert Basic Auth.

Anschließend beim jeweiligen Proxy Host unter **Access List** die passende Liste auswählen.

### Custom Header (Advanced Tab)

Im **Advanced**-Tab jedes Proxy Hosts folgenden Eintrag hinzufügen:

**Admin-Host:**
```nginx
proxy_set_header X-Role "admin";
```

**Cloud-Host:**
```nginx
proxy_set_header X-Role "cloud";
```

## Rollenverhalten

| Zugriff | Header | Settings-Button |
|---------|--------|-----------------|
| Lokal (LAN) | kein Header | sichtbar |
| `admin.domain.de` | `X-Role: admin` | sichtbar |
| `cloud.domain.de` | `X-Role: cloud` | ausgeblendet |

## Go-Server

Endpunkt `/api/me` liest den `X-Role`-Header und gibt die Rolle zurück.
Fehlt der Header (lokaler Zugriff), wird `admin` zurückgegeben.

## Frontend

Beim Start wird `/api/me` abgerufen. Bei Rolle `cloud` wird der Settings-Button
ausgeblendet — sowohl im Desktop-Header als auch im Mobile-Header.
