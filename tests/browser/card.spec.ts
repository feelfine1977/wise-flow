import { type Page, expect, test } from "@playwright/test";

/**
 * An activity's card in the interactive map, in a real browser: hover,
 * selection and focus change its outline and never its fill, and a card
 * outside the scope keeps a solid outline and writes its name in the muted
 * ink. The parity story of the small P2P has a card outside the scope.
 */

const card = (id: string) => `.react-flow__node[data-id="${id}"] > .wf-node`;

/** The fill, the outline and the name's colour of a card, and its states. */
const look = (page: Page, id: string) =>
  page.locator(card(id)).evaluate((el) => {
    const cs = getComputedStyle(el);
    const name = el.querySelector(".wf-activity-name > span");
    return {
      fill: cs.backgroundColor,
      outline: [cs.borderTopStyle, cs.borderTopWidth, cs.borderTopColor].join(" "),
      name: name ? getComputedStyle(name).color : "",
      state: el.getAttribute("data-wf-state") ?? "",
    };
  });

test("hover, selection and focus outline a card and leave its fill; a card outside the scope is outlined solid with a muted name", async ({ page }) => {
  await page.goto("/iframe.html?id=parity--small&viewMode=story");
  await page.waitForSelector(card("change_price"), { timeout: 60_000 });
  const rest = await look(page, "change_price");
  expect(rest).toMatchObject({ fill: "rgb(255, 255, 255)", outline: "solid 1px rgb(140, 148, 161)", name: "rgb(31, 31, 31)" });

  await page.hover(card("change_price"));
  await expect(page.locator(card("change_price"))).toHaveAttribute("data-wf-state", /\bhovered\b/);
  const hovered = await look(page, "change_price");
  expect([hovered.fill, hovered.outline]).toEqual([rest.fill, "solid 1px rgb(31, 31, 31)"]);

  await page.click(card("change_price"));
  await page.mouse.move(0, 0);
  await expect(page.locator(card("change_price"))).toHaveAttribute("data-wf-state", /\bselected\b/);
  const selected = await look(page, "change_price");
  expect([selected.fill, selected.outline]).toEqual([rest.fill, "solid 1px rgb(0, 114, 178)"]);

  // The keyboard's position is focused: an outline around the card.
  const map = page.locator(".wf-process-map");
  await map.focus();
  await page.keyboard.press("Home");
  const id = (await map.getAttribute("aria-activedescendant"))!.replace(/^wf-node-/, "");
  await expect(page.locator(card(id))).toHaveAttribute("data-wf-state", /\bfocused\b/);
  const focused = await page.locator(card(id)).evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).outlineStyle]);
  expect(focused).toEqual([(await look(page, id)).fill, "solid"]);
  expect(focused[0]).toBe(rest.fill);

  // Outside the scope: hatched over its paper, a solid outline and the name in the muted ink.
  const outside = await look(page, "service_entry");
  expect(outside.state).toContain("outOfScope");
  expect(outside).toMatchObject({ fill: rest.fill, outline: "solid 1px rgb(140, 148, 161)", name: "rgb(91, 98, 112)" });
});
