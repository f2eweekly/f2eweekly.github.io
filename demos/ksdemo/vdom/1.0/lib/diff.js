/**
 * Created by 弘树<tiehang.lth@alibaba-inc.com> on 14-7-27.
 * @component diff
 */
KISSY.add(function (S, VPatch, typeCheck, handleThunk) {

	"use strict";

	var isArray = S.isArray;
	var isObject = S.isObject;

	var isVNode = typeCheck.isVirtualNode,
		isVText = typeCheck.isVirtualText,
		isWidget = typeCheck.isWidget,
		isThunk = typeCheck.isThunk;

	function diff(a, b) {
		var patch = { a: a };
		walk(a, b, patch, 0);
		return patch;
	}

	function walk(a, b, patch, index) {
		if (a === b) {
			if (isThunk(a) || isThunk(b)) {
				thunks(a, b, patch, index)
			} else {
				hooks(b, patch, index)
			}
			return
		}

		var apply = patch[index];

		if (b == null) {
			apply = appendPatch(apply, new VPatch(VPatch.REMOVE, a, b))
			destroyWidgets(a, patch, index)
		} else if (isThunk(a) || isThunk(b)) {
			thunks(a, b, patch, index)
		} else if (isVNode(b)) {
			if (isVNode(a)) {
				if (a.tagName === b.tagName &&
					a.key === b.key) {
					var propsPatch = diffProps(a.properties, b.properties, b.hooks)
					if (propsPatch) {
						apply = appendPatch(apply,
							new VPatch(VPatch.PROPS, a, propsPatch))
					}
				} else {
					apply = appendPatch(apply, new VPatch(VPatch.VNODE, a, b))
					destroyWidgets(a, patch, index)
				}

				apply = diffChildren(a, b, patch, apply, index)
			} else {
				apply = appendPatch(apply, new VPatch(VPatch.VNODE, a, b))
				destroyWidgets(a, patch, index)
			}
		} else if (isVText(b)) {
			if (!isVText(a)) {
				apply = appendPatch(apply, new VPatch(VPatch.VTEXT, a, b))
				destroyWidgets(a, patch, index)
			} else if (a.text !== b.text) {
				apply = appendPatch(apply, new VPatch(VPatch.VTEXT, a, b))
			}
		} else if (isWidget(b)) {
			apply = appendPatch(apply, new VPatch(VPatch.WIDGET, a, b))

			if (!isWidget(a)) {
				destroyWidgets(a, patch, index)
			}
		}

		if (apply) {
			patch[index] = apply
		}
	}

	function diffProps(a, b, hooks) {
		var diff;

		for (var aKey in a) {
			if (!(aKey in b)) {
				diff = diff || {};
				diff[aKey] = undefined
			}

			var aValue = a[aKey];
			var bValue = b[aKey];

			if (hooks && aKey in hooks) {
				diff = diff || {}
				diff[aKey] = bValue
			} else {
				if (isObject(aValue) && isObject(bValue)) {
					if (getPrototype(bValue) !== getPrototype(aValue)) {
						diff = diff || {}
						diff[aKey] = bValue
					} else {
						var objectDiff = diffProps(aValue, bValue)
						if (objectDiff) {
							diff = diff || {}
							diff[aKey] = objectDiff
						}
					}
				} else if (aValue !== bValue) {
					diff = diff || {}
					diff[aKey] = bValue
				}
			}
		}

		for (var bKey in b) {
			if (!(bKey in a)) {
				diff = diff || {}
				diff[bKey] = b[bKey]
			}
		}

		return diff
	}

	function getPrototype(value) {
		if (Object.getPrototypeOf) {
			return Object.getPrototypeOf(value)
		} else if (value.__proto__) {
			return value.__proto__
		} else if (value.constructor) {
			return value.constructor.prototype
		}
	}

	function diffChildren(a, b, patch, apply, index) {
		var aChildren = a.children
		var bChildren = reorder(aChildren, b.children)

		var aLen = aChildren.length
		var bLen = bChildren.length
		var len = aLen > bLen ? aLen : bLen

		for (var i = 0; i < len; i++) {
			var leftNode = aChildren[i]
			var rightNode = bChildren[i]
			index += 1

			if (!leftNode) {
				if (rightNode) {
					// Excess nodes in b need to be added
					apply = appendPatch(apply,
						new VPatch(VPatch.INSERT, null, rightNode))
				}
			} else if (!rightNode) {
				if (leftNode) {
					// Excess nodes in a need to be removed
					patch[index] = new VPatch(VPatch.REMOVE, leftNode, null)
					destroyWidgets(leftNode, patch, index)
				}
			} else {
				walk(leftNode, rightNode, patch, index)
			}

			if (isVNode(leftNode) && leftNode.count) {
				index += leftNode.count
			}
		}

		if (bChildren.moves) {
			// Reorder nodes last
			apply = appendPatch(apply, new VPatch(VPatch.ORDER, a, bChildren.moves))
		}

		return apply
	}

// Patch records for all destroyed widgets must be added because we need
// a DOM node reference for the destroy function
	function destroyWidgets(vNode, patch, index) {
		if (isWidget(vNode)) {
			if (typeof vNode.destroy === "function") {
				patch[index] = new VPatch(VPatch.REMOVE, vNode, null)
			}
		} else if (isVNode(vNode) && vNode.hasWidgets) {
			var children = vNode.children
			var len = children.length
			for (var i = 0; i < len; i++) {
				var child = children[i]
				index += 1

				destroyWidgets(child, patch, index)

				if (isVNode(child) && child.count) {
					index += child.count
				}
			}
		}
	}

// Create a sub-patch for thunks
	function thunks(a, b, patch, index) {
		var nodes = handleThunk(a, b);
		var thunkPatch = diff(nodes.a, nodes.b);
		if (hasPatches(thunkPatch)) {
			patch[index] = new VPatch(VPatch.THUNK, null, thunkPatch)
		}
	}

	function hasPatches(patch) {
		for (var index in patch) {
			if (index !== "a") {
				return true;
			}
		}

		return false;
	}

	// Execute hooks when two nodes are identical
	function hooks(vNode, patch, index) {
		if (isVNode(vNode)) {
			if (vNode.hooks) {
				patch[index] = new VPatch(VPatch.PROPS, vNode.hooks, vNode.hooks)
			}

			if (vNode.descendantHooks) {
				vNode.children.forEach(function(child){
					index += 1;

					hooks(child, patch, index);

					if (isVNode(child) && child.count) {
						index += child.count;
					}
				});
			}
		}
	}

	// List diff, naive left to right reordering
	function reorder(aChildren, bChildren) {

		var bKeys = keyIndex(bChildren);

		if (!bKeys) {
			return bChildren;
		}

		var aKeys = keyIndex(aChildren);

		if (!aKeys) {
			return bChildren;
		}

		var bMatch = {}, aMatch = {};

		for (var key in bKeys) {
			bMatch[bKeys[key]] = aKeys[key];
		}

		for (var key in aKeys) {
			aMatch[aKeys[key]] = bKeys[key];
		}

		var aLen = aChildren.length;
		var bLen = bChildren.length;
		var len = aLen > bLen ? aLen : bLen;
		var shuffle = [];
		var freeIndex = 0;
		var i = 0;
		var moveIndex = 0;
		var moves = {};
		var removes = moves.removes = {};
		var reverse = moves.reverse = {};
		var hasMoves = false;

		while (freeIndex < len) {
			var move = aMatch[i]
			if (move !== undefined) {
				shuffle[i] = bChildren[move];
				if (move !== moveIndex) {
					moves[move] = moveIndex;
					reverse[moveIndex] = move;
					hasMoves = true
				}
				moveIndex++
			} else if (i in aMatch) {
				shuffle[i] = undefined;
				removes[i] = moveIndex++;
				hasMoves = true
			} else {
				while (bMatch[freeIndex] !== undefined) {
					freeIndex++;
				}

				if (freeIndex < len) {
					var freeChild = bChildren[freeIndex];
					if (freeChild) {
						shuffle[i] = freeChild;
						if (freeIndex !== moveIndex) {
							hasMoves = true;
							moves[freeIndex] = moveIndex;
							reverse[moveIndex] = freeIndex;
						}
						moveIndex++
					}
					freeIndex++
				}
			}
			i++;
		}

		if (hasMoves) {
			shuffle.moves = moves
		}

		return shuffle;
	}

	function keyIndex(children) {
		var keys = {};

		S.each(children, function (child, index){
			if (child.key !== undefined) {
				keys[child.key] = index;
			}
		});

		return keys;
	}

	function appendPatch(apply, patch) {
		if (apply) {
			return isArray(apply) ? apply.concat(patch) : [apply, patch];
		} else {
			return patch;
		}
	}

	return diff;
}, {requires: [
	'./vpatch',
	'./type-check',
	'./handle-thunk'
]});