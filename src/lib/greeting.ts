/**
 * The greeting on the Collections hero.
 *
 * It is five words on a screen full of money, and it is here rather than inline because the one
 * thing it can do wrong is be wrong — "Good morning" at four in the afternoon is the kind of
 * detail that quietly tells a person the screen is not paying attention, and a screen people
 * think is not paying attention is a screen they stop believing figures on.
 *
 * The boundaries are the firm's own day, not an even split of the clock: the floor starts at
 * eight, breaks at one, and is off the phones by five.
 */
export function greetingFor(at: Date): string {
  const h = at.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * What to call the person, given whatever the profile carries.
 *
 * FIRST NAME ONLY. The mockup reads "GOOD MORNING, STEPHAN" and a greeting that answers with a
 * full name reads as a letter from a bank. Returns null where there is no name to use, and the
 * caller drops the comma rather than greeting nobody by name — "Good morning," with nothing
 * after it is worse than "Good morning".
 */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first === '' ? null : first
}

/** The whole line, ready to render. */
export function greetingLine(at: Date, name: string | null | undefined): string {
  const who = firstNameOf(name)
  return who === null ? greetingFor(at) : `${greetingFor(at)}, ${who}`
}
