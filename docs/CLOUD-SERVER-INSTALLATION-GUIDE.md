# LawLink 云服务器安装指南（技术小白版）

> 适用版本：LawLink `v2.0.0`
>
> 版本说明核对日期：2026-09-21
>
> 推荐系统：Ubuntu Server 24.04 LTS（64 位）
>
> 适用对象：独立律师、中小律所负责人、没有 Linux / Docker 经验的安装人员

> **版本范围**：本指南用于 `v2.0.0` 全新安装；旧库升级须按第十五节及增量升级指南执行。整套云服务器 / Docker / Caddy 部署未在本次重跑，测试结果见[发布验证](./RELEASE-VALIDATION-v2.0.0.md)。
>
> 同目录 Word 安装指南是 v1.2 历史副本，未随本轮修订，不作为当前步骤依据。

## 部署方案

如果准备存放真实案件材料，建议购买 **4 核 CPU、8 GB 内存、100 GB SSD、10 Mbps 或以上带宽**的云服务器，并准备一个单独的二级域名，例如 `law.example.com`。系统选择 Ubuntu Server 24.04 LTS，使用 Docker Compose 运行 LawLink 和 PostgreSQL，再用 Caddy 自动配置 HTTPS。资源表为经验估算，不构成容量或稳定性承诺。

不建议把 2 核 2 GB 的低配服务器用于正式环境；首次构建 LawLink 时可能内存不足。2 核 4 GB、50 GB SSD 只适合 1—3 人短期试用。附件较多时，磁盘容量应优先增加。

LawLink 当前仍属于早期版本。正式导入真实案件前，至少要完成以下四件事：

- 浏览器地址栏显示 HTTPS 和锁形标志；
- `3000`、`5432` 端口不能从公网直接访问；
- 已修改初始管理员密码；
- 已完成一次“数据库 + 附件 + 加密密钥”的异地备份，并确认备份文件不是空文件。

如果上述概念完全陌生，可以照本指南完成测试部署，但真实案件正式上线前，仍建议让懂服务器的人做一次安全复核。

## 一、你最终会得到什么

安装完成后的访问路径如下：

`律师的浏览器 → HTTPS 域名 → Caddy 安全入口 → LawLink → PostgreSQL 数据库 / 加密附件`

日常使用时，律师只需要在浏览器打开自己的域名，不需要接触服务器命令。服务器命令主要在首次安装、备份和版本更新时使用。新版本的权限及首次配置步骤见[本版使用与升级说明](./RELEASE-GUIDE-v2.md)。

## 二、购买服务器和域名前怎么选

### 1. 推荐配置

| 使用规模 | CPU / 内存 | 系统盘 | 带宽 | 建议用途 |
|---|---:|---:|---:|---|
| 1—3 人试用 | 2 核 / 4 GB | 50 GB SSD | 5 Mbps 起 | 只做试用，不建议长期存真实案件 |
| 3—15 人 | **4 核 / 8 GB** | **100 GB SSD** | **10 Mbps 起** | 推荐起步配置 |
| 10—30 人或附件较多 | 8 核 / 16 GB | 200 GB SSD 起 | 20 Mbps 起 | 更稳定，需结合附件量扩容 |

以上是便于安装和维护的经验配置，不是系统最低配置。Word、PDF、图片、录音录像等附件会比数据库本身更快占满磁盘。

### 2. 下单时选择这些项目

- 操作系统：`Ubuntu Server 24.04 LTS 64 位`；
- CPU 架构：优先 `x86_64 / AMD64`；
- 网络：需要公网 IPv4；
- 磁盘：优先 SSD，并开启云厂商自动快照；
- 地域：结合律师事务所所在地、访问速度、客户数据安排和适用的合规要求选择；
- 域名：建议使用独立二级域名，如 `law.example.com`，不要与官网后台混用。

Ubuntu 24.04 LTS 的标准安全维护期到 2029 年，且在 Docker 官方支持列表内。虽然 26.04 LTS 已发布，本指南仍优先选择生态更成熟的 24.04 LTS。

### 3. 云服务器“安全组”只开放这些入站端口

| 端口 | 用途 | 允许来源 |
|---:|---|---|
| 22 | 服务器管理 | 最好只允许管理员固定 IP；没有固定 IP 时可暂时开放，安装后再收紧 |
| 80 | 申请证书、自动跳转 HTTPS | 所有人 |
| 443 | 律师通过 HTTPS 使用 LawLink | 所有人 |

不要开放：

- `3000`：LawLink 内部应用端口；
- `5432`：PostgreSQL 数据库端口；
- 其他没有明确用途的端口。

Docker 官方提示，容器发布的端口可能绕过 `ufw` 等主机防火墙。因此本指南不仅依靠安全组，还会把 `3000`、`5432` 明确绑定到 `127.0.0.1`，让它们只能从服务器本机访问。

## 三、安装前准备清单

开始前准备好：

- 云服务器公网 IP；
- 云厂商提供的登录账号、密码或密钥；
- 已注册的域名及其 DNS 管理权限；
- 一个准备用作管理员账号的真实邮箱；
- 一个密码管理器，用于保存数据库密码、初始管理员密码和两个加密密钥；
- 约 30—60 分钟不被打断的操作时间。

本指南中的 `law.example.com` 必须替换成你自己的域名。不要把示例密码或示例域名原样使用。

## 四、进入服务器

最省事的方法是打开云厂商控制台，找到服务器后的“登录”“远程连接”或“Web 终端”。进入黑色命令窗口后再继续。

如果使用自己电脑的终端，可以输入：

```bash
ssh root@YOUR_SERVER_IP
```

部分云厂商的 Ubuntu 默认用户名是 `ubuntu`，此时改为：

```bash
ssh ubuntu@YOUR_SERVER_IP
```

后续命令均应逐段复制，粘贴后按回车。看到错误时先停止，不要连续重复执行。

## 五、更新系统并安装基础工具

依次执行：

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git nano openssl ca-certificates curl gnupg
```

如果系统提示必须重启，执行：

```bash
sudo reboot
```

等待约 1 分钟，再重新登录服务器。

## 六、安装 Docker 和 Docker Compose

以下命令来自 Docker 官方 Ubuntu 安装方法。逐段执行：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
```

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

检查是否安装成功：

```bash
sudo docker --version
sudo docker compose version
sudo systemctl is-active docker
```

成功标准：前两行能显示版本号，最后一行显示 `active`。Docker Compose 应为 `2.24.4` 或更高版本。

## 七、下载固定版本的 LawLink

不要直接把持续变化的 `main` 分支用于真实案件。本指南对照 `v2.0.0` 的源码编排，评估时固定安装该版本：

```bash
sudo mkdir -p /opt/lawlink
sudo chown -R "$(id -un)":"$(id -gn)" /opt/lawlink
git clone --branch v2.0.0 --depth 1 https://github.com/lawflow-boop/LawLink.git /opt/lawlink
cd /opt/lawlink
```

检查：

```bash
git describe --tags --exact-match
```

应显示：

```text
v2.0.0
```

## 八、创建服务器专用的安全配置

### 1. 创建环境变量文件

先复制模板：

```bash
cd /opt/lawlink
cp .env.example .env
chmod 600 .env
```

分别执行下面四条命令。每次都会产生一串随机字符，请立即保存到密码管理器，并写清用途；不要截图发到微信群。

数据库密码：

```bash
openssl rand -hex 24
```

登录签名密钥：

```bash
openssl rand -base64 32
```

附件加密主密钥：

```bash
openssl rand -base64 32
```

初始管理员密码：

```bash
openssl rand -base64 18
```

打开配置文件：

```bash
nano .env
```

把以下项目改成真实值。`YOUR_DOMAIN` 换成自己的域名；`DATABASE_PASSWORD` 在两处使用同一个刚生成的数据库密码：

```dotenv
DATABASE_URL="postgresql://lawlink:DATABASE_PASSWORD@127.0.0.1:5432/lawlink?schema=public"

POSTGRES_DB=lawlink
POSTGRES_USER=lawlink
POSTGRES_PASSWORD=DATABASE_PASSWORD
POSTGRES_PORT=5432

NEXTAUTH_SECRET="刚生成的登录签名密钥"
NEXTAUTH_URL="https://YOUR_DOMAIN"

APP_STORAGE_DIR="./storage"
STORAGE_ENCRYPTION_KEY="刚生成的附件加密主密钥"

SEED_ADMIN_EMAIL="你的管理员邮箱"
SEED_ADMIN_PASSWORD="刚生成的初始管理员密码"
SEED_ADMIN_NAME="系统管理员"

COMPOSE_FILE=docker-compose.yml:docker-compose.cloud.yml
COMPOSE_PROFILES=full
```

在 `nano` 中保存：按 `Ctrl + O`，再按回车；退出：按 `Ctrl + X`。

特别注意：`STORAGE_ENCRYPTION_KEY` 丢失后，即使数据库和附件文件仍在，加密附件也可能无法恢复。它必须和备份一起保存在异地安全位置，但不得公开。

### 2. 创建云服务器安全覆盖文件

仓库原有 `docker-compose.yml` 便于本地开发，默认会发布 `3000` 和 `5432`。云服务器不能原样使用。创建一个不修改原文件的覆盖配置：

```bash
nano docker-compose.cloud.yml
```

完整粘贴以下内容。只能使用空格缩进，不要用 Tab 键：

```yaml
services:
  db:
    ports: !override
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"

  app:
    ports: !override
      - "127.0.0.1:3000:3000"
    environment:
      SEED_ADMIN_EMAIL: ${SEED_ADMIN_EMAIL}
      SEED_ADMIN_PASSWORD: ${SEED_ADMIN_PASSWORD}
      SEED_ADMIN_NAME: ${SEED_ADMIN_NAME}
```

保存并退出后检查文件：

```bash
sudo docker compose config --services
```

应看到：

```text
db
app
```

如果出现 `unknown tag !override`，说明 Docker Compose 太旧，应回到第六步安装官方最新版，不要删掉 `!override` 继续运行。

## 九、启动数据库、初始化并启动 LawLink

### 1. 先启动数据库

```bash
cd /opt/lawlink
sudo docker compose up -d db
sudo docker compose ps
```

成功标准：`lawlink-db` 状态最终显示 `healthy`。如果刚启动时显示 `starting`，等待 10 秒后再执行一次 `sudo docker compose ps`。

### 2. 构建 LawLink 应用

```bash
sudo docker compose build app
```

首次构建需要下载依赖，通常要几分钟到二十多分钟，取决于服务器和网络。命令仍在滚动输出时不要关闭窗口、不要反复按回车。

如果出现 `Killed`、`out of memory` 或构建突然中止，通常是内存不足。优先升级到 8 GB 内存；不要通过删除校验或修改项目代码绕过构建。

### 3. 创建数据库表

```bash
sudo docker compose run --rm app npx prisma migrate deploy
```

成功标准：看到迁移已经应用完成，且没有红色错误。

### 4. 创建初始管理员和基础数据

当前运行镜像不含 `src/`，但 seed 的模板生成器依赖这些源码；须临时只读挂载与镜像同标签的 `src/` 和 `tsconfig.json`。直接运行旧版的 `app npx prisma db seed` 命令会缺少模块。下面挂载仅用于初始化，日常应用仍运行构建产物。

```bash
sudo docker compose run --rm \
  -v "$PWD/src:/app/src:ro" \
  -v "$PWD/tsconfig.json:/app/tsconfig.json:ro" \
  app npx prisma db seed
```

成功标准：最后显示 `Seed 完成`。这一步只负责第一次初始化；以后重复执行 seed 不会把已有管理员密码重置为 `.env` 里的值。

### 5. 启动完整系统

```bash
sudo docker compose up -d
sudo docker compose ps
```

成功标准：

- `lawlink-db` 为 `healthy`；
- `lawlink-app` 为 `Up`；
- 没有容器反复 `Restarting`。

### 6. 在服务器内部做第一次健康检查

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

应返回类似（只证明进程能响应，不检查数据库、权限或备份）：

```json
{"name":"LawLink","status":"ok","timestamp":"..."}
```

再检查两个内部端口是否只绑定到本机：

```bash
sudo docker port lawlink-app 3000
sudo docker port lawlink-db 5432
```

成功时应分别显示 `127.0.0.1:3000` 和 `127.0.0.1:5432`。如果显示 `0.0.0.0`，立即停止，不要继续开放真实数据。

## 十、把域名指向服务器

进入域名服务商的 DNS 管理页面，新增一条 `A` 记录：

- 主机记录：例如 `law`；
- 记录类型：`A`；
- 记录值：云服务器公网 IPv4；
- TTL：使用默认值。

如果域名是 `example.com`，主机记录填 `law` 后，完整域名就是 `law.example.com`。

没有配置可用 IPv6 时，不要随意添加 `AAAA` 记录。DNS 生效可能需要几分钟到数小时。

可以在服务器检查：

```bash
getent ahostsv4 YOUR_DOMAIN
```

输出中应出现云服务器公网 IPv4。

## 十一、安装 HTTPS 安全入口 Caddy

### 1. 安装 Caddy

逐段执行 Caddy 官方安装命令：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### 2. 配置域名转发

```bash
sudo nano /etc/caddy/Caddyfile
```

删除原内容，粘贴以下两行，并把 `YOUR_DOMAIN` 换成自己的完整域名：

```caddyfile
YOUR_DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
```

保存退出后，检查并重新加载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl is-active caddy
```

最后一行应显示 `active`。只要域名已经指向服务器，且安全组开放 `80`、`443`，Caddy 会自动申请和续期 HTTPS 证书，并把 HTTP 自动跳转到 HTTPS。

### 3. 用自己电脑的浏览器验证

打开：

```text
https://YOUR_DOMAIN/login
```

成功标准：

- 能看到 LawLink 登录页；
- 地址以 `https://` 开头；
- 浏览器没有“不安全”或证书警告；
- 直接打开 `http://YOUR_DOMAIN` 会自动跳到 HTTPS。

如果能通过 `http://服务器IP:3000` 从公网打开 LawLink，说明端口保护没有生效，应立即检查第八、九节。

## 十二、第一次登录后必须完成的设置

使用 `.env` 中的 `SEED_ADMIN_EMAIL` 和首次生成的管理员密码登录。

登录后按顺序完成：

1. 打开“个人设置 → 个人资料”（`/settings/profile`），核对本人信息和密码；
2. 进入“管理后台 → 律所信息”（`/admin/firm-profile`）补齐本所资料；
3. 在“用户管理、岗位角色、律师团队”设置独立账号及真实岗位。新账号须登记证件类型与号码，证件照片选填；先确认本所采集和保管安排；
4. 在“审批权限”（`/admin/approval-permissions`）配置合格审批人和具体事项；超级管理员也须获事项授权。单人执业若需自批须显式开启例外；
5. 在“归档制度”（`/admin/archive-policy`）录入本所制度原文及清单，否则不能提交正式归档；
6. 按需配置外部服务和提醒；“订阅日历”入口在日程页；
7. 用隔离测试资料验证收案、审批、材料上传下载、开票/用章及归档，不同岗位核对访问边界；
8. 退出后核对未登录无法访问业务页面，完成首次备份与恢复演练。

不要把身份证、真实案卷或客户联系方式作为“试试看”的第一批数据。

## 十三、第一次备份：数据库、附件和密钥缺一不可

LawLink 的完整恢复至少需要三部分：

- PostgreSQL 数据库；
- `app_storage` 中的加密附件；
- `.env` 中的 `STORAGE_ENCRYPTION_KEY` 等密钥。

证件照片也属于文件存储的一部分，备份时一并保护；若另配对象存储，须备份对应存储桶。

只备份数据库，不能恢复附件；只备份附件但丢失加密主密钥，也可能无法读取附件。

在服务器执行：

```bash
cd /opt/lawlink
LAWLINK_BACKUP_DIR="$HOME/lawlink-backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LAWLINK_BACKUP_DIR"
```

备份数据库：

```bash
sudo docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6' > "$LAWLINK_BACKUP_DIR/database.dump"
```

备份附件：

```bash
sudo docker compose exec -T app tar -czf - -C /app/storage . > "$LAWLINK_BACKUP_DIR/storage.tar.gz"
```

备份密钥配置并限制读取权限：

```bash
cp .env "$LAWLINK_BACKUP_DIR/lawlink.env"
chmod 600 "$LAWLINK_BACKUP_DIR/lawlink.env"
```

生成校验值：

```bash
sha256sum "$LAWLINK_BACKUP_DIR/database.dump" "$LAWLINK_BACKUP_DIR/storage.tar.gz" "$LAWLINK_BACKUP_DIR/lawlink.env" > "$LAWLINK_BACKUP_DIR/SHA256SUMS"
ls -lh "$LAWLINK_BACKUP_DIR"
```

成功标准：`database.dump`、`storage.tar.gz`、`lawlink.env` 和 `SHA256SUMS` 都存在，前三个文件大小都不是 0。

接下来必须把整个备份目录复制到服务器以外的加密存储，例如另一云账号的对象存储、NAS 的加密备份或加密移动硬盘。仅保存在同一台服务器上不算真正备份。

本版 Docker 运行镜像已包含 `scripts/backup.sh`、bash 和 PostgreSQL 16 客户端，Compose 为备份目录挂载命名卷。仍需检查实际备份结果并安排异地保存与恢复演练；定时任务注册不等于备份可恢复。上面的宿主机备份步骤仍可用于人工核验和独立备份。

建议：

- 在宿主机安排每天备份数据库和附件；
- 至少保留 7 个日备份、4 个周备份、6 个⽉备份；
- 每月至少抽查一次备份大小和校验值；
- 第一次正式使用前做一次恢复演练；
- 恢复会覆盖现有数据，技术小白不要直接在生产服务器上试恢复，应在临时服务器上演练或请技术人员协助。

## 十四、日常检查

每周或发现访问异常时执行：

```bash
cd /opt/lawlink
sudo docker compose ps
df -h
sudo systemctl is-active caddy
curl -fsS https://YOUR_DOMAIN/api/health
```

重点看：

- `lawlink-db` 是否 `healthy`；
- `lawlink-app` 是否 `Up`；
- 系统盘使用率是否低于 80%；
- Caddy 是否 `active`；
- 健康接口是否返回 `status: ok`。

每月安排维护窗口更新 Ubuntu 安全补丁：

```bash
sudo apt update
sudo apt upgrade -y
```

更新后如果系统要求重启，先确认最新备份可用，再在无人使用时重启服务器。

## 十五、升级 LawLink

先备份数据库、附件和密钥，停止业务写入，并在隔离副本演练。[1.3.x 升级指南](./RELEASE-GUIDE-v1.3.md)规定：增量 SQL → 标记 0_init → 标记 archive_borrow 的完整迁移目录名 → deploy。仅更新代码或只做基线标记均不能完成升级。RC1 用户须先核对已应用迁移，不得套用 1.3.x 增量脚本。

正式标签保留源码内部 1.4.0 名称；对外版本为 2.0.0。

## 十六、常见问题

### 1. 浏览器显示 502 Bad Gateway

含义：Caddy 正常，但 LawLink 应用没有正常响应。

```bash
cd /opt/lawlink
sudo docker compose ps
sudo docker compose logs --tail 100 app
```

先记录最后一屏错误，不要删除容器或数据卷。

### 2. `lawlink-db` 一直不是 healthy

```bash
sudo docker compose logs --tail 100 db
df -h
```

常见原因是数据库密码配置不一致、磁盘已满或数据库异常。不要反复执行 seed。

### 3. HTTPS 证书申请失败

依次检查：

- 域名 A 记录是否指向当前服务器公网 IP；
- 安全组是否开放 TCP 80 和 443；
- Caddyfile 中是否为完整域名，且没有写 `http://`；
- 是否有其他软件占用了 80、443 端口。

查看日志：

```bash
sudo journalctl -u caddy --no-pager -n 100
```

### 4. 初始管理员无法登录

确认 seed 是否成功执行，并核对 `.env` 中的 `SEED_ADMIN_EMAIL`。seed 使用 `upsert`，再次运行不会修改已经存在的管理员密码，因此不能把“重跑 seed”当作重置密码方法。

### 5. 构建时出现 Killed 或内存不足

优先把服务器升级到 8 GB 内存后重新构建。临时交换空间只能应急，不能替代长期内存配置。

### 6. 磁盘快满了

先执行：

```bash
df -h
sudo docker system df
```

不要自行运行带 `--volumes` 的清理命令。案件附件和数据库都保存在 Docker 数据卷中，误删数据卷可能造成不可恢复的数据丢失。

## 十七、绝对不要执行的命令

除非已经确认备份并由技术人员指导，否则不要执行：

```text
docker compose down -v
docker volume rm ...
docker system prune --volumes
rm -rf /opt/lawlink
```

其中 `-v`、`volume rm`、`--volumes` 都可能删除数据库或附件。遇到问题时，优先保存日志和备份，不要以“删除重装”作为第一反应。

## 十八、正式上线验收清单

以下项目是环境验收的一部分，仍须先处理本页开头列明的依赖安全风险：

- [ ] 使用 Ubuntu Server 24.04 LTS 64 位；
- [ ] 服务器配置至少达到计划使用规模；
- [ ] 安全组只开放必要的 22、80、443；
- [ ] `3000`、`5432` 只绑定 `127.0.0.1`；
- [ ] 域名和 HTTPS 正常，无证书警告；
- [ ] 已处理适用的依赖安全风险并重跑审计、测试和构建；
- [ ] 管理员密码已修改，每人使用独立账号；
- [ ] 业务岗位、系统管理、团队访问和事项审批分别配置并验证；
- [ ] 本所归档制度及材料清单已配置，实际审批/归档流程已验证；
- [ ] 证件资料与照片采集、访问和保管安排已经核对；
- [ ] `/api/health` 返回 `status: ok`；
- [ ] 数据库容器为 `healthy`，应用容器为 `Up`；
- [ ] 测试客户、测试案件、测试附件的创建和下载均正常；
- [ ] 已备份数据库、附件和 `.env`；
- [ ] 备份已复制到服务器以外的加密存储；
- [ ] 已明确谁负责每周检查、每月更新和故障联系；
- [ ] 已评估律师保密义务、个人信息保护、数据安全和档案管理要求。

## 十九、官方参考资料

- [LawLink GitHub 仓库](https://github.com/lawflow-boop/LawLink)
- [Ubuntu 24.04 LTS 发布说明与支持期](https://documentation.ubuntu.com/release-notes/24.04/)
- [Docker Engine：Ubuntu 官方安装方法](https://docs.docker.com/engine/install/ubuntu/)
- [Docker 端口发布与本机绑定说明](https://docs.docker.com/engine/network/port-publishing/)
- [Docker Compose 生产环境说明](https://docs.docker.com/compose/how-tos/production/)
- [Docker Compose `!override` 合并规则](https://docs.docker.com/reference/compose-file/merge/)
- [Caddy 官方安装方法](https://caddyserver.com/docs/install)
- [Caddy HTTPS 快速指南](https://caddyserver.com/docs/quick-starts/https)
- [Caddy 自动 HTTPS 说明](https://caddyserver.com/docs/automatic-https)

---

文档维护提示：LawLink 发布新标签、数据库初始化方式、Compose 文件或环境变量发生变化时，应先更新本指南，再调整对外安装实践。

公开版全新安装的案件、客户及财务业务列表为空，管理员和基础字典/模板属于必要初始化配置。不要从开发环境复制模拟案件数据库或附件作为公开安装包。
