# Despliegue en el VPS (Ubuntu) → https://kanban.grwnr.com

Se hace **una sola vez** a mano. Después, cada push a `main` despliega solo (`.github/workflows/deploy.yml`).

Los comandos son para Ubuntu 24.04 (o similar) y se ejecutan como `root`, por SSH o desde la **terminal del navegador de Hostinger** (hPanel → VPS → Terminal), que sirve igual desde cualquier dispositivo y no depende de ninguna clave de tu PC.

La clave de despliegue del paso 3 **se añade** al usuario `deploy`; no cambia ni restringe tu acceso como root.

## 1. DNS
En Hostinger (hPanel → Dominios → Zona DNS de `grwnr.com`) crea un registro **A**: nombre `kanban`, valor la IP del VPS (y un **AAAA** si el VPS tiene IPv6). Comprueba con `nslookup kanban.grwnr.com`.

## 2. Sistema, usuario y firewall
```bash
apt update && apt -y upgrade
apt -y install nginx git sqlite3 ufw certbot python3-certbot-nginx unattended-upgrades
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt -y install nodejs
node --version   # debe ser v24.x

adduser --disabled-password --gecos "" deploy
install -d -o deploy -g deploy /srv/kanban /var/lib/kanban /var/backups/kanban

ufw allow OpenSSH
ufw allow "Nginx Full"
ufw --force enable
```
**Endurecimiento de SSH (opcional, no lo hagas por defecto).** Desactivar `PasswordAuthentication` o el login de root con contraseña mejora la seguridad, pero puede dejarte sin acceso si la terminal del navegador de Hostinger entra por SSH con contraseña. Solo hazlo después de comprobar cómo entra esa terminal y con una sesión de root ya abierta. Mientras tanto, la protección es `ufw`, `unattended-upgrades` y una contraseña de root larga.

## 3. Claves
**a) Clave de GitHub Actions → VPS** (en tu PC, sin contraseña, solo para esto):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/kanban_deploy -N "" -C "github-actions-kanban"
```
Añade `~/.ssh/kanban_deploy.pub` al VPS:
```bash
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "<contenido de kanban_deploy.pub>" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
```

**b) Clave de solo lectura VPS → GitHub** (como `deploy`: `su - deploy`):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_read -N "" -C "vps-kanban-read"
printf 'Host github.com\n  IdentityFile ~/.ssh/github_read\n  IdentitiesOnly yes\n' >> ~/.ssh/config
cat ~/.ssh/github_read.pub
```
Pega esa clave pública en GitHub → repo `GRWnR/kanban` → Settings → Deploy keys → **sin** permiso de escritura.

## 4. Código y configuración (como `deploy`)
```bash
git clone git@github.com:GRWnR/kanban.git /srv/kanban      # la primera vez GitHub pide confirmar su huella
cd /srv/kanban && npm ci --omit=dev
cp .env.example .env && chmod 600 .env
npm run hash-password      # copia la línea ADMIN_PASSWORD_HASH=... resultante
```
Edita `.env`: `NODE_ENV=production`, `DATA_DIR=/var/lib/kanban`, `HOST=127.0.0.1`, `PORT=3000` y pega el `ADMIN_PASSWORD_HASH`.

## 5. Servicio
```bash
cp /srv/kanban/deploy/kanban.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now kanban
systemctl status kanban --no-pager
curl -s http://127.0.0.1:3000/api/health      # {"ok":true}

# deploy solo puede reiniciar este servicio:
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart kanban' > /etc/sudoers.d/kanban-deploy
chmod 440 /etc/sudoers.d/kanban-deploy && visudo -cf /etc/sudoers.d/kanban-deploy
```

## 6. Nginx y HTTPS
```bash
cp /srv/kanban/deploy/nginx-kanban.conf /etc/nginx/sites-available/kanban
ln -s /etc/nginx/sites-available/kanban /etc/nginx/sites-enabled/kanban
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d kanban.grwnr.com --redirect -m TU_CORREO --agree-tos --no-eff-email
```
Certbot instala la renovación automática (`systemctl list-timers | grep certbot`).

## 7. Copias de seguridad
```bash
chmod +x /srv/kanban/deploy/backup.sh
echo '0 3 * * * deploy /srv/kanban/deploy/backup.sh >> /var/backups/kanban/backup.log 2>&1' > /etc/cron.d/kanban-backup
sudo -u deploy /srv/kanban/deploy/backup.sh    # prueba manual
```
Para restaurar: para el servicio, `gunzip -c copia.db.gz > /var/lib/kanban/kanban.db` (como `deploy`) y arranca de nuevo. Conviene copiar de vez en cuando `/var/backups/kanban` fuera del VPS.

## 8. Secrets de GitHub
Repo → Settings → Secrets and variables → Actions:

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP o `kanban.grwnr.com` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | contenido completo de `~/.ssh/kanban_deploy` (clave **privada** del paso 3a) |
| `VPS_KNOWN_HOSTS` | salida de `ssh-keyscan -t ed25519 <IP>`; verifica la huella con la que muestra la consola del VPS en hPanel |

## Comprobación final
- `https://kanban.grwnr.com` carga con candado válido y pide contraseña.
- `curl -i https://kanban.grwnr.com/api/state` devuelve 401 sin sesión.
- Un push a `main` ejecuta *Deploy* en verde y la app sigue respondiendo.
- Al día siguiente existe un `.db.gz` en `/var/backups/kanban`.
