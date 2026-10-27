// XPath sobre el volcado de uiautomator, con la misma convención que Appium: cada elemento se llama
// como su clase (android.widget.Button) y los atributos son los del XML (@text, @resource-id, @content-desc…).
//
// Admite lo que se usa en la práctica:
//   /hierarchy/android.widget.FrameLayout/android.widget.LinearLayout[2]/android.widget.Button
//   //android.widget.Button[@resource-id="com.app:id/login"]
//   //*[@text="Aceptar" and @clickable="true"]
//   //*[contains(@content-desc,"Perfil")]   //*[starts-with(@text,"Hola")]   //*[text()="Enviar"]
//   (//android.widget.EditText)[2]   //*[@text="x"]/..   //*[last()]   //*[not(@text="")]
//   //*[@text=$perfil]   (variables del flujo: el valor se compara tal cual, aunque lleve comillas)
//   //*[@text="Ana"]/following::android.widget.Button[1]   …/following-sibling::*[1]

/**
 * Elementos que cumplen el XPath, en orden de documento. `nodes` es la salida de parseUiDump;
 * `vars`, las variables del flujo que se pueden usar como $nombre.
 */
export function queryXpath(nodes, xpath, vars = {}) {
  const expr = new Parser(String(xpath || '').trim()).parseTop();
  // Documento → elemento <hierarchy> → elementos <node>, como en el XML de uiautomator.
  const hierarchy = { hierarchy: true, index: -1, cls: 'hierarchy', attrs: {}, children: nodes.filter((n) => n.parent == null).map((n) => n.index) };
  const root = { root: true, index: -2, hierarchy };
  const ctx = { nodes, root, hierarchy, vars };
  return evalTop(expr, ctx);
}

/** Comprueba la sintaxis sin buscar nada (para avisar al guardar un nodo). */
export function validateXpath(xpath) {
  new Parser(String(xpath || '').trim()).parseTop();
}

// ---------- análisis ----------

class XpathError extends Error {}

class Parser {
  constructor(src) {
    if (!src) throw new XpathError('El XPath está vacío');
    this.src = src;
    this.i = 0;
  }

  fail(msg) {
    throw new XpathError(`XPath no válido (${msg}, posición ${this.i + 1}): ${this.src}`);
  }

  ws() { while (/\s/.test(this.src[this.i] || '')) this.i++; }
  peek(s) { this.ws(); return this.src.startsWith(s, this.i); }
  eat(s) { if (this.peek(s)) { this.i += s.length; return true; } return false; }
  expect(s) { if (!this.eat(s)) this.fail(`se esperaba "${s}"`); }

  /** Ruta completa, o "(ruta)[n]" para quedarse con el n-ésimo resultado global. */
  parseTop() {
    let expr;
    if (this.eat('(')) {
      expr = { type: 'group', path: this.parsePath(), preds: [] };
      this.expect(')');
      while (this.peek('[')) expr.preds.push(this.parsePredicate());
      if (this.peek('/')) expr = { type: 'continue', base: expr, path: this.parsePath(true) };
    } else {
      expr = this.parsePath();
    }
    this.ws();
    if (this.i < this.src.length) this.fail('sobra texto');
    return expr;
  }

  parsePath(relativeToBase = false) {
    const steps = [];
    if (!this.peek('/') && !relativeToBase) this.fail('debe empezar por / o //');
    while (this.peek('/')) {
      const axis = this.eat('//') ? 'descendant' : (this.eat('/'), 'child');
      steps.push(this.parseStep(axis));
    }
    if (!steps.length) this.fail('falta la ruta');
    return { type: 'path', steps };
  }

  parseStep(axis) {
    this.ws();
    if (this.eat('..')) return { axis: 'parent', name: '*', preds: [] };
    if (this.eat('.')) return { axis: 'self', name: '*', preds: [] };
    const named = this.src.slice(this.i).match(/^(following-sibling|following|child|descendant)::/);
    if (named) {
      if (axis === 'descendant' && named[1] !== 'child') this.fail(`no se puede usar // con ${named[1]}::`);
      this.i += named[0].length;
      axis = axis === 'descendant' ? 'descendant' : named[1];
    }
    const m = this.src.slice(this.i).match(/^(\*|[A-Za-z_][\w.$-]*)/);
    if (!m) this.fail('falta el nombre del elemento');
    this.i += m[0].length;
    const step = { axis, name: m[0], preds: [] };
    while (this.peek('[')) step.preds.push(this.parsePredicate());
    return step;
  }

  parsePredicate() {
    this.expect('[');
    const e = this.parseOr();
    this.expect(']');
    return e;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.eatWord('or')) left = { type: 'or', left, right: this.parseAnd() };
    return left;
  }

  parseAnd() {
    let left = this.parseCmp();
    while (this.eatWord('and')) left = { type: 'and', left, right: this.parseCmp() };
    return left;
  }

  eatWord(w) {
    this.ws();
    const re = new RegExp(`^${w}(?![\\w-])`);
    if (re.test(this.src.slice(this.i))) { this.i += w.length; return true; }
    return false;
  }

  parseCmp() {
    const left = this.parseValue();
    for (const op of ['!=', '=']) {
      if (this.eat(op)) return { type: 'cmp', op, left, right: this.parseValue() };
    }
    return left;
  }

  parseValue() {
    this.ws();
    const c = this.src[this.i];
    if (c === '(') { this.i++; const e = this.parseOr(); this.expect(')'); return e; }
    if (c === '"' || c === "'") {
      const end = this.src.indexOf(c, this.i + 1);
      if (end < 0) this.fail('falta cerrar las comillas');
      const value = this.src.slice(this.i + 1, end);
      this.i = end + 1;
      return { type: 'str', value };
    }
    if (c === '$') {
      this.i++;
      const m = this.src.slice(this.i).match(/^[\w.-]+/);
      if (!m) this.fail('falta el nombre de la variable');
      this.i += m[0].length;
      return { type: 'var', name: m[0] };
    }
    if (c === '@') {
      this.i++;
      const m = this.src.slice(this.i).match(/^[\w-]+/);
      if (!m) this.fail('falta el nombre del atributo');
      this.i += m[0].length;
      return { type: 'attr', name: m[0] };
    }
    const num = this.src.slice(this.i).match(/^\d+/);
    if (num) { this.i += num[0].length; return { type: 'num', value: Number(num[0]) }; }
    const fn = this.src.slice(this.i).match(/^([a-z-]+)\s*\(/);
    if (fn) {
      this.i += fn[0].length;
      const args = [];
      if (!this.peek(')')) {
        do args.push(this.parseOr()); while (this.eat(','));
      }
      this.expect(')');
      const name = fn[1];
      const arity = { contains: 2, 'starts-with': 2, 'ends-with': 2, not: 1, text: 0, last: 0, position: 0 }[name];
      if (arity == null) this.fail(`función no admitida: ${name}()`);
      if (args.length !== arity) this.fail(`${name}() lleva ${arity} argumento(s)`);
      return { type: 'fn', name, args };
    }
    this.fail('se esperaba @atributo, "texto", número o función');
  }
}

// ---------- evaluación ----------

function children(ctx, n) {
  if (n.root) return [ctx.hierarchy];
  return n.children.map((i) => ctx.nodes[i]);
}

function parentOf(ctx, n) {
  if (n.root) return null;
  if (n.hierarchy) return ctx.root;
  return n.parent == null ? ctx.hierarchy : ctx.nodes[n.parent];
}

function descendantsOrSelf(ctx, n, out = []) {
  out.push(n);
  for (const c of children(ctx, n)) descendantsOrSelf(ctx, c, out);
  return out;
}

// El elemento raíz del volcado se llama "hierarchy"; el resto, como su clase. "node" también vale.
const nameMatches = (n, name) => name === '*' || n.cls === name || (name === 'node' && !n.hierarchy);

function applyPreds(list, preds, ctx) {
  for (const p of preds) {
    const size = list.length;
    list = list.filter((n, i) => {
      const v = evalExpr(p, { ...ctx, node: n, pos: i + 1, size });
      return typeof v === 'number' ? v === i + 1 : truthy(v);
    });
  }
  return list;
}

function evalSteps(steps, start, ctx) {
  let current = start;
  for (const step of steps) {
    const next = new Set();
    for (const n of current) {
      let groups;
      if (step.axis === 'self') groups = [[n]];
      else if (step.axis === 'parent') groups = n.root ? [] : [[parentOf(ctx, n)]];
      // "//x[1]" es el primer x de cada padre, como en XPath estándar.
      else if (step.axis === 'descendant') groups = descendantsOrSelf(ctx, n).map((p) => children(ctx, p));
      else if (step.axis === 'following-sibling') {
        const sib = n.index < 0 ? [] : children(ctx, parentOf(ctx, n));
        groups = [sib.slice(sib.indexOf(n) + 1)];
      } else if (step.axis === 'following') {
        // Todo lo que va después en el documento, sin contar los descendientes del propio elemento.
        const inside = new Set(descendantsOrSelf(ctx, n).map((x) => x.index));
        groups = [n.index < 0 ? [] : ctx.nodes.filter((x) => x.index > n.index && !inside.has(x.index))];
      }
      else groups = [children(ctx, n)];
      for (const g of groups) {
        const named = step.axis === 'parent' || step.axis === 'self' ? g.filter((x) => x.root || nameMatches(x, step.name)) : g.filter((x) => nameMatches(x, step.name));
        for (const x of applyPreds(named, step.preds, ctx)) next.add(x);
      }
    }
    current = [...next];
  }
  return current.filter((n) => n.index >= 0).sort((a, b) => a.index - b.index);
}

function evalTop(expr, ctx) {
  if (expr.type === 'path') return evalSteps(expr.steps, [ctx.root], ctx);
  if (expr.type === 'group') return applyPreds(evalSteps(expr.path.steps, [ctx.root], ctx), expr.preds, ctx);
  if (expr.type === 'continue') return evalSteps(expr.path.steps, evalTop(expr.base, ctx), ctx);
  return [];
}

const truthy = (v) => (typeof v === 'string' ? v !== '' : !!v);
const str = (v) => (v == null ? '' : String(v));

function evalExpr(e, ctx) {
  switch (e.type) {
    case 'str': return e.value;
    case 'num': return e.value;
    case 'attr': return ctx.node.attrs?.[e.name] ?? null;
    case 'var': {
      if (!(e.name in ctx.vars)) throw new XpathError(`La variable $${e.name} del XPath no está definida en el flujo`);
      return str(ctx.vars[e.name]);
    }
    case 'and': return truthy(evalExpr(e.left, ctx)) && truthy(evalExpr(e.right, ctx));
    case 'or': return truthy(evalExpr(e.left, ctx)) || truthy(evalExpr(e.right, ctx));
    case 'cmp': {
      const a = evalExpr(e.left, ctx);
      const b = evalExpr(e.right, ctx);
      // Un atributo que no existe nunca es igual a nada, como en XPath.
      if (a === null || b === null) return false;
      const eq = typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : str(a) === str(b);
      return e.op === '=' ? eq : !eq;
    }
    case 'fn': {
      const a = e.args.map((x) => evalExpr(x, ctx));
      switch (e.name) {
        case 'contains': return str(a[0]).includes(str(a[1]));
        case 'starts-with': return str(a[0]).startsWith(str(a[1]));
        case 'ends-with': return str(a[0]).endsWith(str(a[1]));
        case 'not': return !truthy(a[0]);
        case 'text': return ctx.node.attrs?.text ?? '';
        case 'last': return ctx.size;
        case 'position': return ctx.pos;
      }
    }
  }
  return null;
}

// ---------- generación (inspector) ----------

// XPath 1.0 no tiene escapes: un valor con comillas simples y dobles a la vez no se puede escribir.
const quote = (v) => (!v.includes('"') ? `"${v}"` : !v.includes("'") ? `'${v}'` : null);

/** XPath absoluto, posición a posición desde la raíz: siempre único, pero se rompe si cambia la pantalla. */
export function absoluteXpath(nodes, n) {
  const parts = [];
  for (let cur = n; cur; cur = cur.parent == null ? null : nodes[cur.parent]) {
    const siblings = cur.parent == null ? nodes.filter((x) => x.parent == null) : nodes[cur.parent].children.map((i) => nodes[i]);
    const same = siblings.filter((x) => x.cls === cur.cls);
    const name = cur.cls || 'node';
    parts.unshift(same.length > 1 ? `${name}[${same.indexOf(cur) + 1}]` : name);
  }
  return `/hierarchy/${parts.join('/')}`;
}

/**
 * XPath corto y único para el elemento, basado en sus atributos (más estable que el absoluto).
 * Si ninguna combinación de atributos lo identifica, se usa el absoluto.
 */
export function bestXpath(nodes, n) {
  const cls = n.cls || '*';
  const a = n.attrs || {};
  const id = a['resource-id'] && quote(a['resource-id']);
  const text = a.text && quote(a.text);
  const desc = a['content-desc'] && quote(a['content-desc']);
  const candidates = [];
  if (id) candidates.push(`//${cls}[@resource-id=${id}]`);
  if (text) candidates.push(`//${cls}[@text=${text}]`);
  if (desc) candidates.push(`//${cls}[@content-desc=${desc}]`);
  if (id && text) candidates.push(`//${cls}[@resource-id=${id} and @text=${text}]`);
  if (id && desc) candidates.push(`//${cls}[@resource-id=${id} and @content-desc=${desc}]`);
  for (const x of candidates) {
    const found = queryXpath(nodes, x);
    if (found.length === 1 && found[0] === n) return x;
  }
  // Varios iguales (por ejemplo, filas de una lista): el n-ésimo con ese atributo.
  for (const x of candidates.slice(0, 3)) {
    const found = queryXpath(nodes, x);
    const pos = found.indexOf(n);
    if (pos >= 0) return `(${x})[${pos + 1}]`;
  }
  return absoluteXpath(nodes, n);
}

export { XpathError };
