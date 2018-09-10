import * as DOM from './DOM'
import { getUid } from './utils'
import { diffList, getDiffProps } from './list-diff'
import {
    VTEXT,
    VELEMENT,
    VSTATELESS,
    VCOMPONENT,
    getChildrenFromVcomponent,
    MOVES_ADD,
    MOVES_DELETE,
    MOVES_REORDER,
    isString
} from './utils'
import { addEvent } from './event-system'
import { getContextByTypes, getChildContext } from './context'

export function createVcomponent({ vtype, type, props, key, ref }) {
    let vcomponent = {
        type,
        props,
        vtype,
        key,
        ref
    }
    if (vtype === VCOMPONENT) {
        vcomponent.uid = getUid()
    }
    return vcomponent
}

export function initVnode(vcomponent, parentContext) {
    let { vtype } = vcomponent,
        node = null
    if (!vtype) { // init text
        node = initText(vcomponent, parentContext)
    } else if (vtype === VELEMENT) {
        node = initElement(vcomponent, parentContext)
    } else if (vtype === VCOMPONENT) {
        node = initVcomponent(vcomponent, parentContext)
    } else if (vtype === VSTATELESS) {
        node = initStateless(vcomponent, parentContext)
    }
    return node
}

export function initText(text) {
    return document.createTextNode(text)
}

export function initElement(vcomponent, parentContext) {
    const { type, props } = vcomponent
    let vchildren = getChildrenFromVcomponent(vcomponent)
    let node = document.createElement(type)
    setProps(node, props)
    vchildren.forEach(childVnode => {
        DOM.appendChildren(node, initVnode(childVnode, parentContext))
    })

    return node
}

const pendingComponents = []
export function initVcomponent(vcomponent, parentContext) {
    const { type: Component, props, uid } = vcomponent
    const component = new Component(props)
    const context = getContextByTypes(parentContext, Component.contextTypes)
    const { $cache: cache, $updater: updater } = component

    updater.isPending = true

    component.props = component.props || props
    component.context = context

    if (component.componentWillMount) {
        component.componentWillMount()
    }

    const vnode = renderComponent(component)
    const node = initVnode(vnode, getChildContext(component, parentContext))

    node.cache = node.cache || {}
    node.cache[uid] = component

    cache.vnode = vnode
    cache.node = node
    cache.isMounted = true
    cache.parentContext = parentContext

    pendingComponents.push(component)
    return node
}

function clearPendingComponents() {
    let len = pendingComponents.length
    if (!len) {
        return
    }
    let compoenent
    while (compoenent = pendingComponents.shift()) {
        let updater = compoenent.$updater
        if (compoenent.componentDidMount) {
            compoenent.componentDidMount()
        }
        updater.isPending = false
        updater.emitUpdate()
    }
}

export function clearPending() {
    clearPendingComponents()
}
export function initStateless(vcomponent, parentContext) {
    const { uid } = vcomponent
    const vnode = getStateless(vcomponent, parentContext)
    const node = initVnode(vnode, parentContext)
    node.cache = node.cache || {}
    node.cache[uid] = vnode
    return node
}

export function getStateless(vcomponent, parentContext) {
    const { type: factory, props } = vcomponent
    const context = getContextByTypes(parentContext, factory.contextTypes)
    let vnode = factory(props, context)
    if (vnode && vnode.render) {
        vnode = vnode.render()
    }
    return vnode
}

export function renderComponent(component) {
    return component.render()
}

export function destroyVnode(vcomponent, node) {
    const { vtype } = vcomponent
    if (vtype === VELEMENT) {

    } else if (vtype === VCOMPONENT) {

    }
}

export function compareTwoVnodes(oldVnode, newVnode, node) {
    let newNode = node
    if (!newVnode) {
        //如果新节点是空，销毁node并且移移除
        destroyVnode(oldVnode, node)
        node.parentNode.removeChild(node)
    } else if (oldVnode.type !== newVnode.type || oldVnode.key !== newVnode.key) {
        //type或者key不同，完全重构
        destroyVnode(oldVnode, node)
        newNode = initVnode(newVnode)
        node.parentNode.replaceChild(newNode, node)
    } else {
        //非上述情况则更新
        newNode = updateVnode(oldVnode, newVnode, node)
    }
    return newNode
}

export function updateVnode(oldVnode, newVnode, node) {
    const { vtype, type } = oldVnode
    if (!type) {
        if (oldVnode !== newVnode) {
            node.data = newVnode
        }
        return node
    }

    if (vtype === VCOMPONENT) {
        updateVcomponent(oldVnode, newVnode, node)
    }
    if (vtype === VSTATELESS) {
        updateVstateless(oldVnode, newVnode, node)
    }

    if (vtype === VELEMENT) {
        updateElement(oldVnode, newVnode, node)
    }
    return node
}

export function updateVcomponent(vcomponent, newVcomponent, node) {
    let uid = vcomponent.uid
    let component = node.cache[uid]
    let { $updater: updater, $cache: cache } = component
    node.cache[newVcomponent.uid] = component

    let nextState = newVcomponent.state
    let nextProps = newVcomponent.props
    let nextContext = newVcomponent.context
    if (component.componengReceiveProps) {
        let isNotPending = !updater.isPending
        if (isNotPending) updater.isPending = true
        component.componengReceiveProps(nextProps, nextState)
        if (isNotPending) updater.isPending = false
    }
    updater.emitUpdate(nextProps, nextContext)
}

export function updateVstateless(vcomponent, newVcomponent, node) {
    let uid = vcomponent.uid
    let vnode = node.cache[uid]
    delete node.cache[uid]
    let newVnode = getStateless(newVcomponent)
    let newNode = compareTwoVnodes(vnode, newVnode, node)
    newNode.cache = newNode.cache || {}
    newNode.cache[uid] = newVnode
    if (newNode !== node) {
        syncCache(newNode.cache, node.cache, newNode)
    }
    return newVnode
}

export function updateElement(oldVnode, newVnode, node) {
    let diffProps = getDiffProps(oldVnode.props, newVnode.props)
    diffProps && setProps(node, diffProps)
    updateChildren(oldVnode, newVnode, node)
    return node
}

export function updateChildren(oldVnode, newVnode, node) {
    let { diff, newChildren, children } = diffList(oldVnode, newVnode)
    let childNodes = node ? node.childNodes : []

    let j = 0
    for (let i = 0; i < children.length; i++) {
        if (newChildren !== 'listNull') {//listNull说明需要删掉，会在patch里删除
            compareTwoVnodes(children[i], newChildren[i], childNodes[i - j])
            if (newChildren[i] === null) {
                //如果newChildren[i] 是null，说明不带key并且已经被删除了，nodes需要向前瞬移一位
                j++
            }

        }
    }
    patchChildren(node, diff)
}



export function setProps(node, props) {
    let ignoreList = ['children', 'key']
    for (let name in props) {
        if (ignoreList.find(res => res === name)) {
            continue
        } else if (name === 'style') {
            let styleObject = props[name]
            for (let sKey in styleObject) {
                node.style[sKey] = styleObject[sKey]
            }
            continue
        } else if (name.startsWith('on') >= 0) {
            addEvent(node, name, props[name])
            continue
        } else if (typeof props[name] === "function") {
            continue
        }
        node.setAttribute(name, props[name])
    }
}

export function patchChildren(node, diff) {
    let childNodes = node.childNodes
    diff.length > 0 && diff.forEach(function (singleDiff) {
        switch (singleDiff.type) {
            //delete
            case MOVES_DELETE:
                node.removeChild(childNodes[singleDiff.index])
                break
            //add
            case MOVES_ADD:
                var newNode = isString(singleDiff.item) ? singleDiff.item : initVnode(singleDiff.item)
                if (childNodes.length > singleDiff.index) {
                    node.insertBefore(newNode, childNodes[singleDiff.index])
                } else {
                    node.appendChild(newNode)
                }
                break
            //move
            case MOVES_REORDER:
                node.insertBefore(childNodes[singleDiff.oldIndex], childNodes[singleDiff.newIndex])
                break
        }
    })
}

export function syncCache(cache, oldCache, node) {
    //如果node改变了，node本身的cahce所带数据需要迁移到新的node上
    //此时如果此node是由component render而来，此时新的node上需要再cache上再次指向此component
    for (let key in oldCache) {
        if (!oldCache.hasOwnProperty(key)) {
            continue
        }
        let value = oldCache[key]
        cache[key] = value

        if (value.forceUpdate) {
            //cache上绑定的东西需要移植
            //如果value是Componnet，则需要更新node
            value.$cache.node = node
        }
    }
}