import {node} from 'aberdeen'

export function createIcon(innerHTML, viewBox = "0 0 24 24") {
  if (typeof viewBox === 'number') viewBox = `0 0 ${viewBox} ${viewBox}`
  return function(...args) {
    let el = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    el.setAttribute("class", "icon")
    el.setAttribute("viewBox", viewBox)
    el.innerHTML = innerHTML
    node(el, ...args)
  }
}

export const edit = createIcon(`<path fill="currentColor" d="m18.988 2.012l3 3L19.701 7.3l-3-3zM8 16h3l7.287-7.287l-3-3L8 13z"/><path fill="currentColor" d="M19 19H8.158c-.026 0-.053.01-.079.01c-.033 0-.066-.009-.1-.01H5V5h6.847l2-2H5c-1.103 0-2 .896-2 2v14c0 1.104.897 2 2 2h14a2 2 0 0 0 2-2v-8.668l-2 2V19z"/>`)

export const bug = createIcon(`<path fill="currentColor" d="M18 14h4v-2h-4v-2h1a2 2 0 0 0 2-2V6h-2v2H5V6H3v2a2 2 0 0 0 2 2h1v2H2v2h4v1a6 6 0 0 0 .09 1H5a2 2 0 0 0-2 2v2h2v-2h1.81A6 6 0 0 0 11 20.91V10h2v10.91A6 6 0 0 0 17.19 18H19v2h2v-2a2 2 0 0 0-2-2h-1.09a6 6 0 0 0 .09-1zM12 2a4 4 0 0 0-4 4h8a4 4 0 0 0-4-4z"/>`, "2 2 20 20")

export const rename = createIcon(`<path fill="currentColor" d="m15 16l-4 4h10v-4h-6m-2.94-8.81L3 16.25V20h3.75l9.06-9.06l-3.75-3.75m6.65.85c.39-.39.39-1.04 0-1.41l-2.34-2.34a1.001 1.001 0 0 0-1.41 0l-1.83 1.83l3.75 3.75l1.83-1.83Z"/>`, "2 2 20 20")

export const save = createIcon(`<path fill="currentColor" d="M21 7v12q0 .825-.588 1.413T19 21H5q-.825 0-1.413-.588T3 19V5q0-.825.588-1.413T5 3h12l4 4Zm-9 11q1.25 0 2.125-.875T15 15q0-1.25-.875-2.125T12 12q-1.25 0-2.125.875T9 15q0 1.25.875 2.125T12 18Zm-6-8h9V6H6v4Z"/>`, "2 2 20 20")

export const remove = createIcon(`<path fill="currentColor" d="M7 21q-.825 0-1.413-.588T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.588 1.413T17 21H7Zm2-4h2V8H9v9Zm4 0h2V8h-2v9Z"/>`, "2 2 20 20")

export const create = createIcon(`<path fill="currentColor" d="M11 17h2v-4h4v-2h-4V7h-2v4H7v2h4zm1 5q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"/>`)
export const createGroup = createIcon(`<path fill="currentColor" d="M14 14q.425 0 .713-.288T15 13v-2h2q.425 0 .713-.288T18 10t-.288-.712T17 9h-2V7q0-.425-.288-.712T14 6t-.712.288T13 7v2h-2q-.425 0-.712.288T10 10t.288.713T11 11h2v2q0 .425.288.713T14 14m-6 4q-.825 0-1.412-.587T6 16V4q0-.825.588-1.412T8 2h12q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18zm-4 4q-.825 0-1.412-.587T2 20V7q0-.425.288-.712T3 6t.713.288T4 7v13h13q.425 0 .713.288T18 21t-.288.713T17 22z"/>`)

export const sensor = createIcon(`<path fill="currentColor" d="M4 22q-.825 0-1.413-.588T2 20v-4h2v4h4v2H4ZM2 8V4q0-.825.588-1.413T4 2h4v2H4v4H2Zm9 10.9q-2.3-.35-3.925-1.975T5.1 13h2q.3 1.475 1.363 2.537T11 16.9v2ZM5.1 11q.35-2.3 1.975-3.938T11 5.1v2q-1.475.3-2.538 1.363T7.1 11h-2Zm6.9 3q-.825 0-1.413-.588T10 12q0-.85.588-1.425T12 10q.85 0 1.425.575T14 12q0 .825-.575 1.413T12 14Zm1 4.9v-2q1.475-.3 2.538-1.363T16.9 13h2q-.325 2.3-1.962 3.925T13 18.9Zm3.9-7.9q-.3-1.475-1.363-2.538T13 7.1v-2q2.3.35 3.938 1.975T18.9 11h-2ZM16 22v-2h4v-4h2v4q0 .825-.588 1.413T20 22h-4Zm4-14V4h-4V2h4q.825 0 1.413.588T22 4v4h-2Z"/>`)

export const admin = createIcon(`<path fill="currentColor" d="M16.68 9.77a4.543 4.543 0 0 1-4.95.99l-5.41 6.52c-.99.99-2.59.99-3.58 0s-.99-2.59 0-3.57l6.52-5.42c-.68-1.65-.35-3.61.99-4.95c1.28-1.28 3.12-1.62 4.72-1.06l-2.89 2.89l2.82 2.82l2.86-2.87c.53 1.58.18 3.39-1.08 4.65zM3.81 16.21c.4.39 1.04.39 1.43 0c.4-.4.4-1.04 0-1.43c-.39-.4-1.03-.4-1.43 0a1.02 1.02 0 0 0 0 1.43z"/>`, "2 2 16 16")

export const eject = createIcon(`<path fill="currentColor" d="M7.27 1.047a1 1 0 0 1 1.46 0l6.345 6.77c.6.638.146 1.683-.73 1.683H1.656C.78 9.5.326 8.455.926 7.816L7.27 1.047zM.5 11.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-1z"/>`, "0 -2 16 15")

export const stop = createIcon(`<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"><path stroke-linejoin="round" d="M8 2L2 8.156V16l6 6h8l6-6V8.156L16 2H8Z"/><path d="M16 12H8"/></g>`)

export const back = createIcon(`<mask id="ipSBack0"><path fill="#fff" fill-rule="evenodd" stroke="#fff" stroke-linejoin="round" stroke-width="4" d="M44 40.836c-4.893-5.973-9.238-9.362-13.036-10.168c-3.797-.805-7.412-.927-10.846-.365V41L4 23.545L20.118 7v10.167c6.349.05 11.746 2.328 16.192 6.833c4.445 4.505 7.009 10.117 7.69 16.836Z" clip-rule="evenodd"/></mask><path fill="currentColor" d="M0 0h48v48H0z" mask="url(#ipSBack0)"/>`, 48)

