//#region src/plugin/invariant.ts
const PACKAGE_NAME = "@omdsh-dev/dsh-genui";
/** Cordis companion plugin name. */
const name = "genui-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: this host plugin only registers a static prompt
* section; the section text is pinned by its own tests.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
