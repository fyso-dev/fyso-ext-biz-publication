# Fyso Biz panel publication

This opt-in extension includes a Cloudflare Worker for the Fyso Biz account
and a connector for a generated Fyso project. The Worker enables or revokes a
publication and forwards HTTP to the connector. The connector makes outbound
HTTPS requests and contacts only the local Caddy gateway. It uses the existing
D62 public address contract. The generated project must support the
`tinyauth.providers.yaml` extension slot for Fyso Biz SSO.

## Project identity

Installed, the extension adds an **Identidad** page to the panel menu. It edits the
project identity: name, a palette or custom colour, typography, corners, icon and
login background, previewed live on the whole panel. The options are enabled only
for a session opened with **Fyso Biz** (Tinyauth provider `fyso-biz`); a local login
sees how to switch. This is a guardrail in the page: anyone with access to the
repository can still edit `project/brand.json` by hand.

Saving runs `ext-biz-publication-brand`, which calls the framework's
`brand.cjs operate`: it validates, commits `project/brand.json` and its images and
reinstalls them for every app. It needs panel extension API v3 (`copier` checks it).

Build the page after changing `panel-src/`:

```sh
FYSO_FRAMEWORK_ROOT=<framework checkout or generated project> mise run build
```

## Service setup

Deploy `service/wrangler.toml` as a separate Worker in the Fyso Biz Cloudflare
account. Configure Worker hosts for the control origin and both public hosts
per project. For `web_domain=demo.fyso.biz` those are `panel.demo.fyso.biz` and
`auth.demo.fyso.biz`. Use [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
for the exact public hosts. Cloudflare provisions DNS and a separate edge
certificate for each host, including nested subdomains.

Set the Worker bindings below in its deployment environment.

| Binding | Value |
| --- | --- |
| `PUBLICATION_CONTROL_HOST` | Service hostname, such as `publish.fyso.biz` |
| `PUBLICATION_ASSIGNMENTS` | JSON object matching each assigned `web_domain` to a verified Fyso Biz account subject |
| `BIZ_ORIGIN` | HTTPS origin of the Fyso Biz OAuth issuer |
| `PUBLICATION_RELAY` | Durable Object binding declared in Wrangler config |

Use `service/wrangler.example.toml` as a deployment example. Replace the example
hosts and set the assignment in the deployment environment. An empty
assignment map keeps publication disabled.

The control endpoint accepts an OAuth token with the Biz `perfil` scope. It
looks up the verified identity through Biz `/oauth/userinfo` and checks its
subject against the domain assignment on each call. Publication starts disabled.

## Project setup and SSO

1. Configure the generated project's `web_domain` with its assigned domain.
   Keep the project stopped during setup.
2. Register a confidential OAuth client in the same Fyso Biz issuer for
   `https://auth.<web_domain>/api/oauth/callback/fyso-biz`. Use Authorization
   Code with PKCE and the `perfil` scope. Keep the client secret private.
3. From the project root install the tagged Copier extension.

   ```sh
   mise run ext:add gh:fyso-dev/fyso-ext-biz-publication -- --vcs-ref v0.1.0 --defaults \
     -d publication_service="https://publish.fyso.biz" \
     -d biz_sso_client_id="<client-id>" \
     -d biz_sso_email="<verified-email>"
   ```

   Set `biz_login_origin` if the OAuth issuer is a different HTTPS origin.
4. Use `mise run secrets` to set `FYSO_AUTH_BIZ_SSO_SECRET` to the
   confidential client secret and `FYSO_PUBLICATION_TOKEN` to the publication
   operator's current `perfil` access token. The connector requires a current
   token and this prototype does not refresh it automatically.
5. Add the exact verified Biz email to `apps.panel.oauth.whitelist` in
   `project/auth/tinyauth.yaml`. Use a comma-separated string if the panel
   already has an OAuth whitelist. The provider whitelist and the project's
   app policy both apply.
6. Run `mise run up` and `mise run biz-publication:publish`. Open the returned
   URL and choose **Fyso Biz** on Tinyauth's login page. An existing Biz session
   supplies the identity. Biz can ask for OAuth consent on first use. Tinyauth
   issues the panel session and retains its own logout.
7. Check `mise run biz-publication:status` and `mise run doctor`. Use
   `mise run biz-publication:revoke` to disable the URL.

The relay supports bounded HTTP requests and responses, with a 1 MiB request
body, a 5 MiB response body, and a 20-second origin round trip. It buffers
responses and supports neither streaming nor WebSocket upgrades. This prototype
requires project domain assignment by the service operator.
