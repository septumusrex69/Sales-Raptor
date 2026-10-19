/**
 * THE ADDRESS A LINK IN A WORKFLOW EMAIL POINTS AT (S9), where there is no request to read a host
 * from -- the morning cron and a release run the step with none.
 *
 * THE DEPLOYMENT THE EMAIL CAME FROM, because a token lives in that deployment's database: a link
 * from the staging preview that opened the production site would find no such request. Production
 * uses its own stable domain; a preview uses its branch's stable address rather than the
 * per-deployment host, so a link in an email sent this morning still opens after tonight's deploy.
 */
export function siteOrigin(): string | null {
  const host = process.env.VERCEL_ENV === 'production'
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
    : process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL
  return host ? `https://${host.replace(/^https?:\/\//, '')}` : null
}
