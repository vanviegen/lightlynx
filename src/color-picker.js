import {node, prop, Store, text, observe, getParentElement, clean} from "aberdeen"
import * as colors from "./colors.js"
import api from "./api.ts"


const CT_MIN = 100, CT_MAX = 550

function drawColorWheelMarker(state, size = 24) {
    node('div.handle', () => {
        let color = state.get('color')

        if (typeof color === 'number') {
            color = colors.miredsToHs(color)
        }
        else if (color==null) {
            prop('style', {display: 'none'})
            return;
        }
        else if (color.x != null) {
            color = colors.xyToHs(color)
        }
        let lsize = state.get('on') ? size : size/4;
        let hueRadians = color[0] * (Math.PI / 180)
        let left = Math.cos(hueRadians) * color[1] * 50 + 50
        let top = Math.sin(hueRadians) * color[1] * 50 + 50
        
        prop('style', {
            display: 'block',
            height: lsize+'px',
            width: lsize+'px',
            marginTop: (-lsize/2)+'px',
            marginLeft: (-lsize/2)+'px',
            top: top+'%',
            left: left+'%',
        })
    })
}

export function drawColorWheel(target) {
    let state = target.ref('state')
    let canvas
    let interval
    let lastEvent

    node('p.wheel', {style: {position: 'relative'}}, () => {
        node('canvas', {
            width: 1,
            height: 1,
            style: {width: "100%"},
            mousedown: track,
            mousemove: track,
            touchstart: track,
            touchmove: track,
        }, () => {

            // Wait for layout to finish, so we can use the final offsetWidth
            canvas = getParentElement()
            setTimeout(paintColorWheelCanvas, 0)

            window.addEventListener('resize', paintColorWheelCanvas)
            clean(() => window.removeEventListener('resize', paintColorWheelCanvas))
        })

        drawColorWheelMarker(state)
        target.onEach('members', ieeeRef => {
            let state = api.store.ref('devices', ieeeRef.get(), 'state')
            drawColorWheelMarker(state, 8)
        })
    })

    function track(e) {
        if (e.type === "mousemove" && !e.buttons) return

        let bounding = canvas.getBoundingClientRect()
        
        let radius = bounding.width / 2
        // (-1..+1)
        let relX = ((e.touches ? e.touches[0].pageX : e.pageX) - bounding.left - radius) / radius
        let relY = ((e.touches ? e.touches[0].pageY : e.pageY) - bounding.top - radius) / radius

        let hue = Math.atan2(relY, relX) * 180 / Math.PI
        if (hue < 0) hue += 360
        let saturation = Math.sqrt(relX*relX + relY*relY)
        api.setLightState(target.index(), {color: [hue, saturation], on: true})
    }

    function paintColorWheelCanvas() {
        let radius = canvas.offsetWidth/2
        canvas.height = canvas.width = radius*2
        let ctx = canvas.getContext("2d")
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        let step = 0.5*Math.atan(1/radius); // in radians

        // draw hue gradient
        for(let rad = -Math.PI; rad < Math.PI; rad += step) {
            let hue = rad / Math.PI * 180

            // get line direction from center
            let x = radius * Math.cos(rad),
                y = radius * Math.sin(rad)

            // set stroke style
            ctx.strokeStyle = 'hsl(' + hue + ', 100%, 50%)'

            // draw color line
            ctx.beginPath()
            ctx.moveTo(radius, radius)
            ctx.lineTo(radius + x, radius + y)
            ctx.stroke()
        }

        // draw saturation gradient
        let grd = ctx.createRadialGradient(radius,radius,0,radius,radius,radius)
        grd.addColorStop(0,'rgba(255, 255, 255, 1)')
        grd.addColorStop(1,'rgba(255, 255, 255, 0)')
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(radius, radius, radius, 0, Math.PI * 2, true)
        ctx.closePath()
        ctx.fill()
    }
}

function drawScaleMarker(state, colorTempRange, size = 24) {
    node('div.handle', () => {
        let lsize = size;
        let fraction
        if (colorTempRange) {
            let colorTemp = state.get('color')

            if (colorTemp instanceof Array) {
                let rgb = colors.hsvToRgb(colorTemp[0], colorTemp[1], state.get('level')/100)
                colorTemp = colors.rgbToMireds(rgb, 50, CT_MIN, CT_MAX)
                lsize = Math.min(lsize, 8)
            }
            if (colorTemp == null) {
                prop('style', {display: 'none'})
                return
            }
            fraction = (colorTemp-colorTempRange[0]) / (colorTempRange[1]-colorTempRange[0])
        } else {
            fraction = state.get('level') / 255
        }
        if (!state.get('on')) {
            lsize /= 4
        }
        prop('style', {
            display: 'block',
            height: lsize+'px',
            width: lsize+'px',
            marginTop: (-lsize/2) + 'px',
            marginLeft: (-lsize/2) + 'px',
            top: '50%',
            left: (fraction*100) + '%',
        })
    })
}

export default function drawColorPicker(target) {
    let capabilities = target.peek("light")
    if (capabilities.brightness) {
        drawScale(target)
    }

    if (capabilities.color_temp || capabilities.color_xy || capabilities.color_hs) {
        let temps = capabilities.color_temp ? [capabilities.color_temp.value_min, capabilities.color_temp.value_max] : [CT_MIN, CT_MAX]
        drawScale(target, temps)
    }

    if (capabilities.color_xy || capabilities.color_hs) {
        drawColorWheel(target)
    }
}


function drawScale(target, colorTempRange) {
    node('p', {
        style: {
            border: '1px solid #333',
            position: 'relative',
            height: '40px',
            borderRadius: '3px'
        }
    }, () => {

        let state = target.ref('state')
    
        node('canvas', {
            width: 300,
            height: 1,
            style: {
                height: '100%',
                width: '100%'
            }
        }, () => {
            let element = getParentElement()
            let ctx = element.getContext("2d")
            
            var imageData = ctx.getImageData(0, 0, element.width, element.height)
            let pixels = imageData.data
            
            let pos = 0

            let baseColor
            if (!colorTempRange) {
                baseColor = colors.toRgb(state.get('color'))
            }

            for(let x=0; x<=300; x++) {
                let rgb
                if (colorTempRange) {
                    rgb = colors.miredsToRgb(x/300*(colorTempRange[1]-colorTempRange[0])+colorTempRange[0])
                } else {
                    rgb = baseColor.map(v => Math.round(v/300*x))
                }
                pixels[pos++] = rgb[0]
                pixels[pos++] = rgb[1]
                pixels[pos++] = rgb[2]
                pixels[pos++] = 255 // alpha
            }
            
            ctx.putImageData(imageData, 0, 0)
        })

        drawScaleMarker(state, colorTempRange)

        target.onEach('members', ieeeRef => {
            let state = api.store.ref('devices', ieeeRef.get(), 'state')
            drawScaleMarker(state, colorTempRange, 8)
        })

        let el = getParentElement()
        function track(e) {
            // console.log('track', e)
            if (e.type === "mousemove" && !e.buttons) return

            let fraction = ((e.touches ? e.touches[0].clientX : e.clientX) - el.offsetLeft) / el.offsetWidth
            let state = colorTempRange ? {
                on: true,
                color: Math.min(colorTempRange[1],Math.max(colorTempRange[0],Math.round(fraction*(colorTempRange[1]-colorTempRange[0])+colorTempRange[0]))),
            } : {
                on: true,
                level: Math.min(255,Math.max(0,Math.round(fraction*255))),
            }
            api.setLightState(target.index(), state)
        }
        prop({
            mousedown: track,
            mousemove: track,
            touchstart: track,
            touchmove: track,
        })
    })
}
