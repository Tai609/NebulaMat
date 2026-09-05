/**
 * SafeMath: a restricted math expression evaluator for GenUI plot specs.
 *
 * The model supplies an expression string like "sin(x) * 2 + 1". It is parsed
 * and evaluated here WITHOUT eval / new Function: a hand-written recursive
 * descent parser over a white-listed function/constant vocabulary. Unknown
 * identifiers, object property access, and call syntax other than the
 * white-listed functions are parse errors, so an adversarial expression
 * cannot reach globals, prototypes, or side effects.
 *
 * Supported grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('-' | '+') unary | power
 *   power   := atom ('^' atom)?
 *   atom    := number | variable | constant | func '(' expr ')' | '(' expr ')'
 *   variable: 'x' (and any single-letter variable present in vars)
 *   constant: 'pi' | 'e' | 'tau'
 *   func    : sin cos tan asin acos atan sqrt cbrt exp log ln abs floor ceil round min max pow
 */
export interface SafeMathOptions {
    /** Variable values; only names present here may be referenced as variables. */
    vars?: Record<string, number>;
}
/**
 * Compile an expression into an evaluable function.
 * @param expr - the math expression. `x` is the sampling variable; any other
 *   name in `vars` is a parameter whose captured value the evaluator returns
 *   (recompile with new vars to change a parameter — expressions are short).
 * @param options - parameter values; `x` is reserved and ignored here.
 * @returns evaluator, or null when the expression is invalid.
 */
export declare function compileMathExpr(expr: string, options?: SafeMathOptions): ((x: number) => number) | null;
/**
 * Sample an expression over a range.
 * @param expr - math expression in x, with optional parameters.
 * @param xMin - inclusive start.
 * @param xMax - inclusive end.
 * @param samples - number of samples (>= 2).
 * @param params - parameter values (e.g. { a: 2, b: 3 }); recompile per change.
 * @returns [x, y] pairs; non-finite samples are dropped.
 */
export declare function sampleExpr(expr: string, xMin: number, xMax: number, samples?: number, params?: Record<string, number>): Array<[number, number]>;
