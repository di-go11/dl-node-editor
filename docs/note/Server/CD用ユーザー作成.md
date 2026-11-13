# DI用のユーザー作成記録(2026/11/12)

## アカウントの条件(セキュリティなどを加味して)

- 専用のローカルアカウントであること(個人のアカウントやAdminを流用しない)
- Adminのグループに入れない(Usersにする)
- パスワードはランダム文字列、「無期限」「ユーザーは変更不可」にする

## アカウント情報

- UserName
  - DlNodeEditor-deploy
- PassWord
  - cwHXOw8Fwzqh9WkmRbM8L9fFG5SxuP

## アカウント作成手順

1. 次のコマンドでローカルのアカウントを生成する

```powershell
New-LocalUser -Name <任意のユーザー名> -Password (Read-Host -AsSecureString) `
  -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires
```

2. Enter後ユーザーのパスワードが求められるため入力→アカウントが生成される。
3. ユーザーをグループに所属させる(今回はUsersグループ)

```powershell
Add-LocalGroupMember -Group "Users" -Member <アカウント名>
```
4. デプロイ先のフォルダを用意

```powershell
New-Item -ItemType Directory E:\apps
icacls E:\apps /grant "<ユーザー名>:(OI)(CI)M"
```

5. 作成したユーザーでログインする

```powershell
Get-NetTCPConnection -State Listen -OwningProcess (Get-Process sshd).Id | Select-Object LocalAddress, LocalPort
Select-String -Path C:\ProgramData\ssh\sshd_config -Pattern "^\s*(Port|ListenAddress)"
```

で確認したところ、sshサーバーは60022ポートで動いていた。

```powershell
ssh -p 60022 <ユーザー名>@localhost
```

6. Github用のデプロイキーを作る

```powershell
mkdir %USERPROFILE%\.ssh
ssh-keygen -t ed25519 -N "" -C "server-deploy" -f %USERPROFILE%\.ssh\id_ed25519
type %USERPROFILE%\.ssh\id_ed25519.pub
```

7. CI用のJenkinsのagentコンテナからsshでデプロイ用アカウントにアクセスできるか確認する。

ホスト側でのIPアドレスにてゲートウェイを持つIPアドレスを採用する。

```powershell
docker exec -it -u jenkins devcontainer-jenkins-agent-1 ssh -p 60022  DlNodeEditor-deploy@192.168.11.20
```

8. host側でJenkins用の鍵ペアを作成する

```powershell
mkdir C:\temp-key
cd C:\temp-key
ssh-keygen -t ed25519 -C "jenkins-deploy" -f deploy_key
Get-Content deploy_key.pub
```

9. 公開鍵をデプロイ用アカウントに登録する

```powershell
ssh -p 60022 DlNodeEditor-deploy@localhost
```

10. ログインした画面で鍵を保存する

```powershell
echo ssh-ed25519 AAAA...（コピーした1行）>> %USERPROFILE%\.ssh\authorized_keys
type %USERPROFILE%\.ssh\authorized_keys
exit
```
