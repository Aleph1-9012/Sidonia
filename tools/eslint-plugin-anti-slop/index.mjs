import { z } from "zod";

const docs = (description) => ({
  type: "problem",
  docs: { description },
  schema: [],
  messages: { forbidden: description },
});

const rule = (description, create) => ({
  meta: docs(description),
  create,
});

const assertionTypes = new Set(["TSAsExpression", "TSTypeAssertion"]);

const isTypeAssertion = (node) => assertionTypes.has(node?.type);

const isConstAssertion = (node) =>
  isTypeAssertion(node) &&
  node.typeAnnotation?.type === "TSTypeReference" &&
  node.typeAnnotation.typeName?.type === "Identifier" &&
  node.typeAnnotation.typeName.name === "const";

const isBroadType = (node) => {
  const type = unwrapParenthesizedType(node);
  return type?.type === "TSStringKeyword" ||
    type?.type === "TSNumberKeyword" ||
    type?.type === "TSBooleanKeyword" ||
    type?.type === "TSAnyKeyword" ||
    type?.type === "TSUnknownKeyword" ||
    type?.type === "TSObjectKeyword" ||
    isEmptyTypeLiteral(type) ||
    (
      type?.type === "TSTypeReference" &&
      type.typeName?.type === "Identifier" &&
      type.typeName.name === "Object"
    ) ||
    (type?.type === "TSUnionType" && type.types.some(isBroadType));
};

const unwrapEvidencePreservingExpression = (node) => {
  let current = node;
  while (
    current?.type === "TSSatisfiesExpression" ||
    current?.type === "TSNonNullExpression" ||
    isConstAssertion(current)
  ) {
    current = current.expression;
  }
  return current;
};

const isKnownInitializer = (node) => {
  const value = unwrapEvidencePreservingExpression(node);
  return value?.type === "Literal" ||
    value?.type === "ObjectExpression" ||
    value?.type === "ArrayExpression" ||
    (value?.type === "TemplateLiteral" && value.expressions.length === 0) ||
    (
      value?.type === "UnaryExpression" &&
      ["+", "-", "!", "~"].includes(value.operator) &&
      value.argument.type === "Literal"
    );
};

const isEmptyObject = (node) =>
  node?.type === "ObjectExpression" && node.properties.length === 0;

const StaticMemberNameSchema = z.string();

const getStaticMemberName = (node) => {
  if (node?.type !== "MemberExpression") {
    return undefined;
  }
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (node.computed && node.property.type === "Literal") {
    const staticMemberName = StaticMemberNameSchema.safeParse(node.property.value);
    if (staticMemberName.success) {
      return staticMemberName.data;
    }
  }
  if (
    node.computed &&
    node.property.type === "TemplateLiteral" &&
    node.property.expressions.length === 0
  ) {
    return node.property.quasis[0]?.value.cooked;
  }
  return undefined;
};

const isStaticMember = (node, object, properties) =>
  node?.type === "MemberExpression" &&
  node.object.type === "Identifier" &&
  node.object.name === object &&
  properties.includes(getStaticMemberName(node));

const unwrapParenthesizedType = (node) => {
  let current = node;
  while (current?.type === "TSParenthesizedType") {
    current = current.typeAnnotation;
  }
  return current;
};

const isUnknownLike = (node) => {
  const type = unwrapParenthesizedType(node);
  return type?.type === "TSUnknownKeyword" ||
    (type?.type === "TSUnionType" && type.types.some(isUnknownLike));
};

const isPromiseUnknown = (node) => {
  const type = unwrapParenthesizedType(node);
  return type?.type === "TSTypeReference" &&
    type.typeName?.type === "Identifier" &&
    type.typeName.name === "Promise" &&
    type.typeArguments?.params?.some(isUnknownLike);
};

const isEmptyTypeLiteral = (node) =>
  node?.type === "TSTypeLiteral" && node.members.length === 0;

const isUnsafeDictionaryValue = (node) => {
  const value = unwrapParenthesizedType(node);
  if (
    value?.type === "TSAnyKeyword" ||
    value?.type === "TSUnknownKeyword" ||
    value?.type === "TSObjectKeyword" ||
    isEmptyTypeLiteral(value)
  ) {
    return true;
  }
  if (
    value?.type === "TSTypeReference" &&
    value.typeName?.type === "Identifier" &&
    value.typeName.name === "Object"
  ) {
    return true;
  }
  if (value?.type === "TSUnionType") {
    return value.types.some(isUnsafeDictionaryValue);
  }
  if (value?.type === "TSIntersectionType") {
    return value.types.some((type) => unwrapParenthesizedType(type)?.type === "TSAnyKeyword");
  }
  return false;
};

const isUnsafeDictionary = (node) => {
  if (node?.type === "TSIndexSignature") {
    return isUnsafeDictionaryValue(node.typeAnnotation?.typeAnnotation);
  }
  if (node?.type === "TSMappedType") {
    return isUnsafeDictionaryValue(node.typeAnnotation);
  }
  if (
    node?.type === "TSTypeReference" &&
    node.typeName?.type === "Identifier" &&
    node.typeName.name === "Record"
  ) {
    const value = node.typeArguments?.params?.[1];
    return isUnsafeDictionaryValue(value);
  }
  return false;
};

const unwrapParameter = (node) => {
  if (node.type === "TSParameterProperty") {
    return unwrapParameter(node.parameter);
  }
  if (node.type === "AssignmentPattern") {
    return unwrapParameter(node.left);
  }
  return node;
};

const getParameterAnnotation = (node) => {
  const parameter = unwrapParameter(node);
  return parameter.typeAnnotation?.typeAnnotation ??
    (parameter.type === "RestElement"
      ? unwrapParameter(parameter.argument).typeAnnotation?.typeAnnotation
      : undefined);
};

const getParameterName = (node) => {
  const parameter = unwrapParameter(node);
  if (parameter.type === "Identifier") {
    return parameter.name;
  }
  if (parameter.type === "RestElement") {
    return getParameterName(parameter.argument);
  }
  return undefined;
};

const findVariable = (sourceCode, node) => {
  let scope = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) {
      return variable;
    }
    scope = scope.upper;
  }
  return undefined;
};

const commentHasSafetyInvariant = (comment) => /\bSAFETY:\s*\S/.test(comment.value);

const isAdjacentComment = (comment, node) =>
  comment.loc.end.line === node.loc.start.line ||
  comment.loc.end.line + 1 === node.loc.start.line;

const getContainingConstruct = (node) => {
  let current = node;
  const containers = new Set([
    "BlockStatement",
    "ClassBody",
    "Program",
    "StaticBlock",
    "SwitchCase",
  ]);
  while (current.parent && !containers.has(current.parent.type)) {
    current = current.parent;
  }
  return current;
};

const hasAdjacentSafetyComment = (sourceCode, node) => {
  const construct = getContainingConstruct(node);
  return [node, construct].some((anchor) =>
    sourceCode.getCommentsBefore(anchor).some((comment) =>
      isAdjacentComment(comment, anchor) && commentHasSafetyInvariant(comment),
    ),
  );
};

const rules = {
  "no-chained-type-assertions": rule(
    "Do not chain type assertions; preserve validated type evidence.",
    (context) => ({
      ":matches(TSAsExpression, TSTypeAssertion)"(node) {
        if (isTypeAssertion(node.expression)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-conditional-empty-object-spread": rule(
    "Do not use an empty object branch to omit a conditional spread.",
    (context) => ({
      SpreadElement(node) {
        if (
          node.argument.type === "ConditionalExpression" &&
          (isEmptyObject(node.argument.consequent) || isEmptyObject(node.argument.alternate))
        ) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-known-value-widening": rule(
    "Do not explicitly widen a known initializer.",
    (context) => ({
      VariableDeclarator(node) {
        const annotation = node.id.type === "Identifier"
          ? node.id.typeAnnotation?.typeAnnotation
          : undefined;
        if (isBroadType(annotation) && isKnownInitializer(node.init)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-module-mocking": rule(
    "Do not mock modules; use real dependencies or an explicit dependency seam.",
    (context) => ({
      CallExpression(node) {
        const callee = node.callee;
        if (
          isStaticMember(callee, "jest", ["mock", "doMock", "unstable_mockModule"]) ||
          isStaticMember(callee, "vi", ["mock", "doMock"])
        ) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-object-parameters": rule(
    "Do not use the broad object type for function parameters.",
    (context) => ({
      ":function"(node) {
        for (const parameter of node.params) {
          const annotation = getParameterAnnotation(parameter);
          if (annotation?.type === "TSObjectKeyword") {
            context.report({ node: parameter, messageId: "forbidden" });
          }
        }
      },
    }),
  ),
  "no-reflect-apply": rule(
    "Do not use Reflect.apply; call typed functions directly.",
    (context) => ({
      CallExpression(node) {
        if (isStaticMember(node.callee, "Reflect", ["apply"])) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-reflect-get": rule(
    "Do not use Reflect.get; use typed access after boundary validation.",
    (context) => ({
      CallExpression(node) {
        if (isStaticMember(node.callee, "Reflect", ["get"])) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-runtime-typeof": rule(
    "Do not use ad hoc runtime typeof narrowing in application logic.",
    (context) => ({
      UnaryExpression(node) {
        if (node.operator === "typeof") {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-shape-in-symbol-names": rule(
    "Name symbols for their domain meaning; do not use shape in symbol names.",
    (context) => ({
      Identifier(node) {
        if (node.name.toLowerCase().includes("shape")) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-unknown-parameters": rule(
    "Do not accept unknown parameters outside the error-cause convention.",
    (context) => ({
      ":function"(node) {
        for (const parameter of node.params) {
          if (
            getParameterName(parameter) !== "cause" &&
            isUnknownLike(getParameterAnnotation(parameter))
          ) {
            context.report({ node: parameter, messageId: "forbidden" });
          }
        }
      },
    }),
  ),
  "no-unknown-returns": rule(
    "Do not expose unknown or Promise<unknown> return contracts.",
    (context) => ({
      ":function"(node) {
        const annotation = node.returnType?.typeAnnotation;
        if (isUnknownLike(annotation) || isPromiseUnknown(annotation)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-unknown-type-aliases": rule(
    "Do not hide unknown behind a type alias.",
    (context) => ({
      TSTypeAliasDeclaration(node) {
        if (isUnknownLike(node.typeAnnotation)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-unsafe-dictionary-type": rule(
    "Dictionary values must carry a validated concrete domain type.",
    (context) => ({
      TSIndexSignature(node) {
        if (isUnsafeDictionary(node)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
      TSMappedType(node) {
        if (isUnsafeDictionary(node)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
      TSTypeReference(node) {
        if (isUnsafeDictionary(node)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
  "no-widen-then-assert": rule(
    "Do not widen known evidence and later assert it back.",
    (context) => {
      const widened = new WeakSet();
      return {
        VariableDeclarator(node) {
          const annotation = node.id.type === "Identifier"
            ? node.id.typeAnnotation?.typeAnnotation
            : undefined;
          if (node.id.type === "Identifier" && isBroadType(annotation) && isKnownInitializer(node.init)) {
            for (const variable of context.sourceCode.getDeclaredVariables(node)) {
              widened.add(variable);
            }
          }
        },
        ":matches(TSAsExpression, TSTypeAssertion)"(node) {
          if (
            node.expression.type === "Identifier" &&
            widened.has(findVariable(context.sourceCode, node.expression))
          ) {
            context.report({ node, messageId: "forbidden" });
          }
        },
      };
    },
  ),
  "require-safety-comment-for-type-assertion": rule(
    "Non-const type assertions require an adjacent SAFETY comment naming the checked invariant.",
    (context) => ({
      ":matches(TSAsExpression, TSTypeAssertion)"(node) {
        if (isConstAssertion(node)) {
          return;
        }
        if (!hasAdjacentSafetyComment(context.sourceCode, node)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    }),
  ),
};

export default { rules };
