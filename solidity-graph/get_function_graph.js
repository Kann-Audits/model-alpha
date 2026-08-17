const parser = require('@solidity-parser/parser');
const fs = require('fs');

function extractFunctionSource(fnName, sourceCode, loc, isModifier = false) {
    if (!fnName) return null;

    const lines = sourceCode.split('\n');

    if (fnName === '<fallback>') {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('function()') || lines[i].includes('function ()')) {
                return extractFunctionBody(lines, i);
            }
        }
        return null;
    }

    const escapedFnName = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyword = isModifier ? 'modifier' : 'function';

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`${keyword} ${escapedFnName}`)) {
            return extractFunctionBody(lines, i);
        }
    }

    return null;
}

function extractFunctionBody(lines, startLineIndex) {
    let functionLines = [];
    let braceCount = 0;
    let started = false;

    for (let i = startLineIndex; i < lines.length; i++) {
        const line = lines[i];
        functionLines.push(line);

        for (let j = 0; j < line.length; j++) {
            if (line[j] === '{') {
                braceCount++;
                started = true;
            } else if (line[j] === '}') {
                braceCount--;
            }
        }

        if (started && braceCount === 0) {
            break;
        }
    }

    return functionLines.join('\n').trim();
}

function findModifierDefinitions(node, modifiers = {}, sourceCode) {
    if (!node) return modifiers;

    if (node.type === 'ModifierDefinition') {
        const modName = node.name;
        modifiers[modName] = {
            name: modName,
            parameters: node.parameters ? node.parameters.map(p => p.name) : [],
            source: extractFunctionSource(modName, sourceCode, node.loc, true)
        };
    }

    if (node.subNodes) {
        node.subNodes.forEach(subNode => findModifierDefinitions(subNode, modifiers, sourceCode));
    }

    return modifiers;
}

function findContractInstances(node, instances = {}) {
    if (!node) return instances;

    if (node.type === 'StateVariableDeclaration') {
        if (!node.variables) return instances;
        node.variables.forEach(variable => {
            if (variable.typeName && variable.typeName.type === 'UserDefinedTypeName') {
                instances[variable.name] = variable.typeName.namePath;
            }
        });
    }

    if (node.subNodes) {
        node.subNodes.forEach(subNode => findContractInstances(subNode, instances));
    }

    return instances;
}

function findConstantDefinitions(node, constants = {}, sourceCode) {
    if (!node) return constants;

    if (node.type === 'StateVariableDeclaration') {
        if (!node.variables) return constants;
        node.variables.forEach(variable => {
            if (variable.isConstant === true || variable.isImmutable === true) {
                const varName = variable.name;
                let value = null;
                if (node.initialValue) {
                    if (node.initialValue.type === 'NumberLiteral') {
                        value = node.initialValue.number;
                    } else if (node.initialValue.type === 'StringLiteral') {
                        value = `"${node.initialValue.value}"`;
                    } else if (node.initialValue.type === 'Identifier') {
                        value = node.initialValue.name;
                    } else if (node.initialValue.type === 'MemberAccess') {
                        value = `${node.initialValue.expression.name}.${node.initialValue.memberName}`;
                    } else if (node.initialValue.type === 'BinaryOperation') {
                        value = extractConstantValue(node.initialValue);
                    } else if (node.initialValue.type === 'FunctionCall') {
                        value = extractConstantValue(node.initialValue);
                    } else {
                        value = `<${node.initialValue.type}>`;
                    }
                }
                constants[varName] = {
                    name: varName,
                    type: variable.typeName ? variable.typeName.namePath || variable.typeName.name : 'unknown',
                    value: value,
                    visibility: variable.visibility || 'internal',
                    isImmutable: variable.isImmutable === true
                };
            }
        });
    }

    if (node.subNodes) {
        node.subNodes.forEach(subNode => findConstantDefinitions(subNode, constants, sourceCode));
    }

    return constants;
}

function extractConstantValue(node) {
    if (!node) return '<unknown>';

    if (node.type === 'NumberLiteral') {
        return node.number;
    } else if (node.type === 'StringLiteral') {
        return `"${node.value}"`;
    } else if (node.type === 'Identifier') {
        return node.name;
    } else if (node.type === 'MemberAccess') {
        return `${node.expression.name}.${node.memberName}`;
    } else if (node.type === 'BinaryOperation') {
        const left = extractConstantValue(node.left);
        const right = extractConstantValue(node.right);
        return `${left} ${node.operator} ${right}`;
    } else if (node.type === 'FunctionCall') {
        if (node.expression && node.expression.type === 'Identifier') {
            return `${node.expression.name}(...)`;
        }
        return '<FunctionCall>';
    }
    return `<${node.type}>`;
}

function findFunctionDefinitions(node, functions = {}, sourceCode, sourceFile = null) {
    if (!node) return functions;

    if (node.type === 'FunctionDefinition') {
        const fnName = node.name || '<fallback>';
        functions[fnName] = {
            name: fnName,
            visibility: node.visibility || 'internal',
            parameters: node.parameters ? node.parameters.map(p => p.name) : [],
            modifiers: node.modifiers ? node.modifiers.map(m => ({
                name: m.name,
                parameters: m.parameters ? extractParameters({ arguments: m.parameters }) : []
            })) : [],
            source: extractFunctionSource(fnName, sourceCode, node.loc),
            sourceFile: sourceFile,
            calls: [],
            isVirtual: node.isVirtual || false,
            override: node.override || false
        };
    }

    if (node.subNodes) {
        node.subNodes.forEach(subNode => findFunctionDefinitions(subNode, functions, sourceCode, sourceFile));
    }

    return functions;
}

function extractParameters(node) {
    if (!node || !node.arguments) return [];

    return node.arguments.map(arg => {
        if (arg.type === 'Identifier') {
            return arg.name;
        } else if (arg.type === 'NumberLiteral') {
            return arg.number;
        } else if (arg.type === 'StringLiteral') {
            return `"${arg.value}"`;
        } else if (arg.type === 'MemberAccess') {
            return `${arg.expression.name}.${arg.memberName}`;
        } else if (arg.type === 'FunctionCall') {
            if (arg.expression && arg.expression.type === 'Identifier') {
                const nestedParams = extractParameters(arg);
                const paramsStr = nestedParams.length > 0 ? `(${nestedParams.join(', ')})` : '()';
                return `${arg.expression.name}${paramsStr}`;
            } else {
                return '<FunctionCall>';
            }
        } else if (arg.type === 'BinaryOperation') {
            const left = extractParameterValue(arg.left);
            const right = extractParameterValue(arg.right);
            return `${left} ${arg.operator} ${right}`;
        } else if (arg.type === 'UnaryOperation') {
            const operand = extractParameterValue(arg.subExpression);
            return `${arg.operator}${operand}`;
        } else {
            return `<${arg.type}>`;
        }
    });
}

function extractParameterValue(node) {
    if (!node) return '<unknown>';

    if (node.type === 'Identifier') {
        return node.name;
    } else if (node.type === 'NumberLiteral') {
        return node.number;
    } else if (node.type === 'StringLiteral') {
        return `"${node.value}"`;
    } else if (node.type === 'MemberAccess') {
        return `${node.expression.name}.${node.memberName}`;
    } else if (node.type === 'FunctionCall') {
        if (node.expression && node.expression.type === 'Identifier') {
            const nestedParams = extractParameters(node);
            const paramsStr = nestedParams.length > 0 ? `(${nestedParams.join(', ')})` : '()';
            return `${node.expression.name}${paramsStr}`;
        } else {
            return '<FunctionCall>';
        }
    } else if (node.type === 'UnaryOperation') {
        const operand = extractParameterValue(node.subExpression);
        return `${node.operator}${operand}`;
    } else {
        return `<${node.type}>`;
    }
}

function analyzeFunctionBodyNested(functionNode, functions, instances, sourceCode, analyzedFunctions = new Set(), callStack = [], functionNodes = {}, librarySourceResolver = null, interfaceImplResolver = null, ast = null, parentContracts = []) {
    if (!functionNode || !functionNode.body) return [];

    const currentFunctionName = functionNode.name || '<fallback>';

    if (analyzedFunctions.has(currentFunctionName) || callStack.includes(currentFunctionName)) return [];

    const localAnalyzed = new Set([...analyzedFunctions]);
    localAnalyzed.add(currentFunctionName);

    const newCallStack = [...callStack, currentFunctionName];

    const variableAssignments = {};
    const directCalls = [];

    function traverse(node, depth = 0) {
        if (!node) return;

        if (node.type === 'VariableDeclarationStatement' && node.initialValue) {
            if (node.initialValue.type === 'FunctionCall' &&
                node.initialValue.expression &&
                node.initialValue.expression.type === 'Identifier' &&
                node.initialValue.expression.name === 'getTroveManager') {

                let variableName = null;
            if (node.variables && node.variables.length > 0) {
                const variable = node.variables[0];
                if (variable && variable.name) {
                    variableName = variable.name;
                }
            }

            if (variableName) {
                variableAssignments[variableName] = {
                    instance: 'getTroveManager()',
                    contractType: 'ITroveManager'
                };
            }
                }
        }

        if (node.type === 'FunctionCall' && node.expression) {
            const expression = node.expression;

            if (expression.type === 'Identifier') {
                const functionName = expression.name;
                if (functions[functionName]) {
                    const fnDef = functions[functionName];
                    const callInfo = {
                        type: 'internal',
                        target: functionName,
                        parameters: extractParameters(node),
                        source: fnDef.source || extractFunctionSource(functionName, sourceCode, undefined),
                        calls: []
                    };

                    const calledFunctionNode = findFunctionNodeByName(functionName, functionNodes);
                    if (calledFunctionNode && !newCallStack.includes(functionName)) {
                        const nestedCalls = analyzeFunctionBodyNested(calledFunctionNode, functions, instances, sourceCode, localAnalyzed, newCallStack, functionNodes, librarySourceResolver, interfaceImplResolver, ast, parentContracts);
                        callInfo.calls = nestedCalls;
                    }

                    directCalls.push(callInfo);
                }
            }

            if (expression.type === 'MemberAccess') {
                if (expression.expression && expression.expression.type === 'Identifier') {
                    const contractInstance = expression.expression.name;
                    const methodName = expression.memberName;

                    const isExternalLibrary = (libName) => {
                        return libName.includes('-contracts') ||
                        libName.includes('-utils') ||
                        libName.startsWith('@');
                    };

                    const isLibraryCall = !instances[contractInstance] &&
                    contractInstance.charAt(0) === contractInstance.charAt(0).toUpperCase() &&
                    !isExternalLibrary(contractInstance);

                    if (isLibraryCall) {
                        let librarySource = '';
                        if (librarySourceResolver) {
                            librarySource = librarySourceResolver(contractInstance, methodName) || '';
                        }
                        directCalls.push({
                            type: 'library',
                            library: contractInstance,
                            method: methodName,
                            parameters: extractParameters(node),
                                         source: librarySource,
                                         calls: []
                        });
                    } else if (instances[contractInstance]) {
                        directCalls.push({
                            type: 'external',
                            instance: contractInstance,
                            contractType: instances[contractInstance],
                            method: methodName,
                            parameters: extractParameters(node),
                                         calls: []
                        });
                    }

                    if (variableAssignments[contractInstance]) {
                        directCalls.push({
                            type: 'external',
                            instance: variableAssignments[contractInstance].instance,
                            contractType: variableAssignments[contractInstance].contractType,
                            method: methodName,
                            parameters: extractParameters(node),
                                         calls: []
                        });
                    }
                }

                if (expression.expression && expression.expression.type === 'Identifier' && expression.expression.name === 'super') {
                    const superMethodName = expression.memberName;
                    let superSource = '';
                    if (librarySourceResolver) {
                        superSource = librarySourceResolver('super', superMethodName) || '';
                    }

                    if (!superSource && parentContracts && parentContracts.length > 0) {
                        for (const parentName of parentContracts) {
                            const parentSource = findParentFunctionSource(parentName, superMethodName, ast, sourceCode);
                            if (parentSource) {
                                superSource = parentSource;
                                break;
                            }
                        }
                    }

                    directCalls.push({
                        type: 'super',
                        target: superMethodName,
                        parameters: extractParameters(node),
                                     source: superSource,
                                     calls: []
                    });
                }

                if (expression.expression && expression.expression.type === 'MemberAccess') {
                    let currentExpr = expression.expression;
                    const callChain = [expression.memberName];

                    while (currentExpr && currentExpr.type === 'MemberAccess') {
                        callChain.unshift(currentExpr.memberName);
                        currentExpr = currentExpr.expression;
                    }

                    if (currentExpr && currentExpr.type === 'Identifier') {
                        const rootLibrary = currentExpr.name;
                        const isExternalLibrary = (libName) => {
                            return libName.includes('-contracts') ||
                            libName.includes('-utils') ||
                            libName.startsWith('@');
                        };
                        const isLibraryCall = rootLibrary.charAt(0) === rootLibrary.charAt(0).toUpperCase() &&
                        !isExternalLibrary(rootLibrary);

                        if (isLibraryCall) {
                            let librarySource = '';
                            if (librarySourceResolver) {
                                librarySource = librarySourceResolver(rootLibrary, callChain[0]) || '';
                            }
                            directCalls.push({
                                type: 'library',
                                library: rootLibrary,
                                method: callChain.join('.'),
                                             parameters: extractParameters(node),
                                             source: librarySource,
                                             calls: []
                            });
                        }
                    }
                }

                if (expression.expression && expression.expression.type === 'FunctionCall') {
                    const innerExpr = expression.expression.expression;
                    if (innerExpr && innerExpr.type === 'Identifier') {
                        const interfaceName = innerExpr.name;
                        const methodName = expression.memberName;

                        if (interfaceName.charAt(0) === 'I' && interfaceName.charAt(1) === interfaceName.charAt(1).toUpperCase()) {
                            const arg = expression.expression.arguments && expression.expression.arguments[0];
                            const actualArg = arg && arg.name;

                            let implementations = [];
                            if (interfaceImplResolver) {
                                implementations = interfaceImplResolver(interfaceName, methodName) || [];
                            }

                            directCalls.push({
                                type: 'interface',
                                interface: interfaceName,
                                argument: actualArg,
                                method: methodName,
                                parameters: extractParameters(node),
                                             implementations: implementations,
                                             calls: []
                            });
                        }
                    }
                }
            }
        }

        for (const key in node) {
            if (node[key] && typeof node[key] === 'object' && key !== 'parent') {
                if (Array.isArray(node[key])) {
                    node[key].forEach(child => traverse(child, depth + 2));
                } else if (node[key].type) {
                    traverse(node[key], depth + 2);
                }
            }
        }
    }

    traverse(functionNode.body, 0);

    return directCalls;
}

function analyzeFunctionBody(functionNode, functions, instances, sourceCode, functionNodes, librarySourceResolver, interfaceImplResolver, ast, parentContracts) {
    const calls = analyzeFunctionBodyNested(functionNode, functions, instances, sourceCode, new Set(), [], functionNodes, librarySourceResolver, interfaceImplResolver, ast, parentContracts);
    const functionName = functionNode.name || '<fallback>';
    if (functions[functionName]) {
        functions[functionName].calls = calls;
    }
}

function findFunctionNodeByName(functionName, functionNodes) {
    return functionNodes[functionName];
}

function collectFunctionNodes(node, functionNodes = {}) {
    if (!node) return functionNodes;

    if (node.type === 'FunctionDefinition') {
        const fnName = node.name || '<fallback>';
        functionNodes[fnName] = node;
    }

    if (node.subNodes) {
        node.subNodes.forEach(subNode => collectFunctionNodes(subNode, functionNodes));
    }

    return functionNodes;
}

function findParentContracts(contract, ast) {
    const parents = [];
    if (!contract || !contract.baseContracts) return parents;

    contract.baseContracts.forEach(base => {
        if (base.baseName && base.baseName.namePath) {
            parents.push(base.baseName.namePath);
        }
    });

    return parents;
}

function findParentFunctionSource(parentName, functionName, ast, sourceCode) {
    if (!ast || !ast.children) return null;

    const parentContract = ast.children.find(c =>
    c.type === 'ContractDefinition' && c.name === parentName
    );

    if (!parentContract) return null;

    return extractFunctionSource(functionName, sourceCode, null);
}

function findInheritedFunctions(contract, ast, sourceCode, parentContracts, allContractsCache, sourceFile = null) {
    const inheritedFunctions = {};

    if (!parentContracts || parentContracts.length === 0) {
        return inheritedFunctions;
    }

    for (const parentName of parentContracts) {
        let parentContract = null;
        let parentAst = ast;
        let parentSource = sourceCode;
        let parentSourceFile = sourceFile;

        if (allContractsCache && allContractsCache.has(parentName)) {
            const cached = allContractsCache.get(parentName);
            parentContract = cached.contract;
            parentSource = cached.source;
            parentSourceFile = cached.file;
            // Use cached contract's AST for parent lookups
            parentAst = cached.ast || parser.parse(cached.source);
        } else if (ast && ast.children) {
            parentContract = ast.children.find(c =>
            c.type === 'ContractDefinition' && c.name === parentName
            );
        }

        if (!parentContract) continue;

        const parentFunctions = findFunctionDefinitions(parentContract, {}, parentSource, parentSourceFile);

        for (const [fnName, fnData] of Object.entries(parentFunctions)) {
            if (!inheritedFunctions[fnName]) {
                inheritedFunctions[fnName] = fnData;
            }
        }

        const grandParentContracts = findParentContracts(parentContract, parentAst);
        const grandParentFunctions = findInheritedFunctions(parentContract, parentAst, parentSource, grandParentContracts, allContractsCache, parentSourceFile);

        for (const [fnName, fnData] of Object.entries(grandParentFunctions)) {
            if (!inheritedFunctions[fnName]) {
                inheritedFunctions[fnName] = fnData;
            }
        }
    }

    return inheritedFunctions;
}

function collectInheritedFunctionNodes(contract, ast, parentContracts, allContractsCache) {
    const inheritedNodes = {};

    if (!parentContracts || parentContracts.length === 0) {
        return inheritedNodes;
    }

    for (const parentName of parentContracts) {
        let parentContract = null;

        if (allContractsCache && allContractsCache.has(parentName)) {
            const cached = allContractsCache.get(parentName);
            parentContract = cached.contract;
        } else if (ast && ast.children) {
            parentContract = ast.children.find(c =>
            c.type === 'ContractDefinition' && c.name === parentName
            );
        }

        if (!parentContract) continue;

        const parentNodes = collectFunctionNodes(parentContract);
        Object.assign(inheritedNodes, parentNodes);

        const grandParentContracts = findParentContracts(parentContract, ast);
        const grandParentNodes = collectInheritedFunctionNodes(parentContract, ast, grandParentContracts, allContractsCache);
        Object.assign(inheritedNodes, grandParentNodes);
    }

    return inheritedNodes;
}

function analyzeAllFunctionBodies(node, functionDefinitions, contractInstances, sourceCode, functionNodes, librarySourceResolver, interfaceImplResolver, ast, parentContracts) {
    if (!node) return;

    if (node.type === 'FunctionDefinition') {
        analyzeFunctionBody(node, functionDefinitions, contractInstances, sourceCode, functionNodes, librarySourceResolver, interfaceImplResolver, ast, parentContracts);
    }

    if (node.subNodes) {
        node.subNodes.forEach(subNode => analyzeAllFunctionBodies(subNode, functionDefinitions, contractInstances, sourceCode, functionNodes, librarySourceResolver, interfaceImplResolver, ast, parentContracts));
    }
}

function analyzeSolidityContract(filePath, filterFunctions = null, librarySourceResolver = null, interfaceImplResolver = null, cachedAst = null, cachedSource = null, allContractsCache = null) {
    const input = cachedSource || fs.readFileSync(filePath).toString('utf8');
    const ast = cachedAst || parser.parse(input);

    if (!ast || !ast.children) {
        return {
            imports: [],
            contractInstances: {},
            modifiers: {},
            constants: {},
            functions: {}
        };
    }

    const imports = ast.children.filter(a => a.type === 'ImportDirective');

    const contract = ast.children.find(a => a.type === 'ContractDefinition');

    if (!contract) {
        return {
            imports: imports.map(i => i.path),
            contractInstances: {},
            modifiers: {},
            constants: {},
            functions: {}
        };
    }

    const contractInstances = findContractInstances(contract);

    const modifierDefinitions = findModifierDefinitions(contract, {}, input);

    const constantDefinitions = findConstantDefinitions(contract, {}, input);

    const functionNodes = collectFunctionNodes(contract);

    const functionDefinitions = findFunctionDefinitions(contract, {}, input, filePath);

    const parentContracts = findParentContracts(contract, ast);

    const inheritedFunctions = findInheritedFunctions(contract, ast, input, parentContracts, allContractsCache, filePath);

    // Only add inherited functions that don't already exist (override handling)
    for (const [fnName, fnData] of Object.entries(inheritedFunctions)) {
        if (!functionDefinitions[fnName]) {
            functionDefinitions[fnName] = fnData;
        }
    }

    const inheritedFunctionNodes = collectInheritedFunctionNodes(contract, ast, parentContracts, allContractsCache);
    Object.assign(functionNodes, inheritedFunctionNodes);

    analyzeAllFunctionBodies(contract, functionDefinitions, contractInstances, input, functionNodes, librarySourceResolver, interfaceImplResolver, ast, parentContracts);

    const filteredFunctions = filterFunctions
    ? Object.fromEntries(
        Object.entries(functionDefinitions)
        .filter(([name]) => filterFunctions.includes(name)))
    : functionDefinitions;

    const connections = {
        imports: imports.map(i => i.path),
        contractInstances: contractInstances,
        modifiers: modifierDefinitions,
        constants: constantDefinitions,
        parentContracts: parentContracts,
        functions: filteredFunctions
    };

    return connections;
}

module.exports = {
    analyzeSolidityContract
};
