export function byId(id: string): HTMLElement;
export function byId<T extends Element>(id: string, elementType: new () => T): T;
export function byId(id: string, elementType: new () => Element = HTMLElement): Element {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Missing or invalid #${id}`);
  return element;
}
