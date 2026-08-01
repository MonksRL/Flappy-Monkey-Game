(function installMonkeyWorldRenderer(global) {
    'use strict';

    const TAU = Math.PI * 2;
    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

    function roundedRect(context, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.arcTo(x + width, y, x + width, y + height, r);
        context.arcTo(x + width, y + height, x, y + height, r);
        context.arcTo(x, y + height, x, y, r);
        context.arcTo(x, y, x + width, y, r);
        context.closePath();
    }

    function seeded(index, salt = 0) {
        const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
        return value - Math.floor(value);
    }

    class BananaCoastRenderer {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.backgroundImage = new Image();
            this.backgroundImage.decoding = 'async';
            // Same illustrated Banana Coast on every platform. The WebP is
            // roughly one sixth the PNG size, which prevents phones showing
            // the procedural fallback for several seconds while it downloads.
            this.backgroundImage.src = 'monkey-world-banana-coast.webp';
            this.decor = Array.from({ length: 94 }, (_, index) => ({
                x: 260 + seeded(index, 1) * (width - 520),
                y: 180 + seeded(index, 2) * (height - 430),
                size: 18 + seeded(index, 3) * 24,
                kind: seeded(index, 4) > .58 ? 'palm' : seeded(index, 5) > .35 ? 'tree' : 'bush',
                phase: seeded(index, 6) * TAU
            })).filter((item) => !(
                item.x > 410 && item.x < 2860 && item.y > 300 && item.y < 1340
            ) || seeded(Math.floor(item.x), 9) > .58);
            this.sparkles = Array.from({ length: 38 }, (_, index) => ({
                x: seeded(index, 20) * width,
                y: 80 + seeded(index, 21) * (height - 160),
                phase: seeded(index, 22) * TAU,
                speed: .45 + seeded(index, 23) * .8
            }));
        }

        islandPath(context, inset = 0) {
            context.beginPath();
            context.moveTo(230 + inset, 260 + inset);
            context.bezierCurveTo(650, 80 + inset, 1250, 120 + inset, 1570, 135 + inset);
            context.bezierCurveTo(2250, 55 + inset, 2920 - inset, 260, 3010 - inset, 660);
            context.bezierCurveTo(3130 - inset, 1160, 2750, 1540 - inset, 2170, 1600 - inset);
            context.bezierCurveTo(1550, 1740 - inset, 810, 1635 - inset, 380 + inset, 1420 - inset);
            context.bezierCurveTo(85 + inset, 1160, 90 + inset, 620, 230 + inset, 260 + inset);
            context.closePath();
        }

        drawOcean(context, now) {
            const gradient = context.createLinearGradient(0, 0, 0, this.height);
            gradient.addColorStop(0, '#0d8fc4');
            gradient.addColorStop(.45, '#12b7cf');
            gradient.addColorStop(1, '#08699f');
            context.fillStyle = gradient;
            context.fillRect(0, 0, this.width, this.height);

            context.save();
            context.globalAlpha = .26;
            context.lineCap = 'round';
            for (let row = 0; row < 22; row += 1) {
                const y = 55 + row * 82;
                const offset = ((now * (.018 + row * .0005)) + row * 97) % 180;
                for (let x = -220 + offset; x < this.width + 220; x += 180) {
                    const wave = Math.sin(now * .002 + row + x * .006) * 6;
                    context.strokeStyle = row % 3 ? '#9deaf1' : '#ffffff';
                    context.lineWidth = row % 3 ? 3 : 5;
                    context.beginPath();
                    context.moveTo(x, y + wave);
                    context.quadraticCurveTo(x + 35, y - 10 + wave, x + 76, y + wave);
                    context.stroke();
                }
            }
            context.restore();
        }

        drawIsland(context, now) {
            context.save();
            context.shadowColor = 'rgba(0,30,55,.42)';
            context.shadowBlur = 38;
            context.shadowOffsetY = 22;
            this.islandPath(context);
            const sand = context.createLinearGradient(0, 200, 0, 1640);
            sand.addColorStop(0, '#ffe895');
            sand.addColorStop(.65, '#f4c75e');
            sand.addColorStop(1, '#edaa3f');
            context.fillStyle = sand;
            context.fill();
            context.restore();

            this.islandPath(context, 75);
            const grass = context.createLinearGradient(0, 200, 0, 1500);
            grass.addColorStop(0, '#82d44d');
            grass.addColorStop(.48, '#4fb748');
            grass.addColorStop(1, '#298e45');
            context.fillStyle = grass;
            context.fill();
            context.strokeStyle = 'rgba(21,92,42,.62)';
            context.lineWidth = 12;
            context.stroke();

            context.save();
            context.globalAlpha = .16;
            for (let index = 0; index < 420; index += 1) {
                const x = 240 + seeded(index, 40) * (this.width - 480);
                const y = 230 + seeded(index, 41) * (this.height - 520);
                context.strokeStyle = seeded(index, 42) > .5 ? '#d8ff80' : '#0c6c35';
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x + 4, y - 9);
                context.stroke();
            }
            context.restore();

            context.save();
            context.strokeStyle = 'rgba(255,255,255,.78)';
            context.lineWidth = 8;
            context.setLineDash([32, 22]);
            context.lineDashOffset = -now * .035;
            this.islandPath(context, 18);
            context.stroke();
            context.restore();
        }

        drawRoads(context) {
            const road = (points, width) => {
                context.save();
                context.lineCap = 'round';
                context.lineJoin = 'round';
                context.strokeStyle = '#dfc58a';
                context.lineWidth = width + 34;
                context.beginPath();
                context.moveTo(points[0][0], points[0][1]);
                for (let index = 1; index < points.length; index += 1) context.lineTo(points[index][0], points[index][1]);
                context.stroke();
                context.strokeStyle = '#26343d';
                context.lineWidth = width;
                context.stroke();
                context.strokeStyle = '#f8dc62';
                context.lineWidth = 5;
                context.setLineDash([46, 34]);
                context.stroke();
                context.restore();
            };
            road([[315, 890], [770, 850], [1190, 890], [1600, 830], [2040, 900], [2840, 820]], 88);
            road([[1590, 280], [1570, 590], [1600, 830], [1560, 1200], [1590, 1500]], 76);
            road([[720, 850], [720, 565], [940, 440]], 62);
            road([[2070, 900], [2290, 655], [2610, 560]], 62);

            context.fillStyle = '#f2d89f';
            context.strokeStyle = '#a77e47';
            context.lineWidth = 5;
            roundedRect(context, 1260, 650, 680, 440, 100);
            context.fill();
            context.stroke();
            context.save();
            context.globalAlpha = .28;
            for (let y = 690; y < 1050; y += 42) for (let x = 1300; x < 1900; x += 54) {
                context.fillStyle = (x / 54 + y / 42) % 2 ? '#bb8f55' : '#ffe7ae';
                roundedRect(context, x, y, 38, 25, 7);
                context.fill();
            }
            context.restore();
        }

        drawPond(context, now) {
            context.save();
            context.translate(1600, 935);
            context.fillStyle = '#86694d';
            context.beginPath();
            context.ellipse(0, 0, 178, 120, -.08, 0, TAU);
            context.fill();
            const gradient = context.createRadialGradient(-35, -35, 10, 0, 0, 170);
            gradient.addColorStop(0, '#6be9ea');
            gradient.addColorStop(1, '#0b8fb8');
            context.fillStyle = gradient;
            context.beginPath();
            context.ellipse(0, -4, 159, 104, -.08, 0, TAU);
            context.fill();
            context.strokeStyle = 'rgba(255,255,255,.58)';
            context.lineWidth = 4;
            for (let ring = 0; ring < 3; ring += 1) {
                context.beginPath();
                context.ellipse(Math.sin(now * .001 + ring) * 24, -8, 50 + ring * 28, 20 + ring * 12, 0, 0, TAU);
                context.stroke();
            }
            context.fillStyle = '#fff4b1';
            context.beginPath();
            context.arc(0, -17, 12, 0, TAU);
            context.fill();
            context.strokeStyle = 'rgba(220,252,255,.85)';
            context.lineWidth = 7;
            context.beginPath();
            context.moveTo(0, -25);
            context.quadraticCurveTo(Math.sin(now * .003) * 25, -108, 0, -142);
            context.stroke();
            context.restore();
        }

        drawTree(context, item, now) {
            const sway = Math.sin(now * .0018 + item.phase) * 4;
            context.save();
            context.translate(item.x, item.y);
            context.shadowColor = 'rgba(0,47,35,.3)';
            context.shadowBlur = 9;
            context.shadowOffsetY = 9;
            if (item.kind === 'bush') {
                context.fillStyle = '#174f36';
                context.beginPath(); context.ellipse(0, 8, item.size * 1.05, item.size * .62, 0, 0, TAU); context.fill();
                context.shadowColor = 'transparent';
                context.fillStyle = '#38a850';
                for (let index = 0; index < 5; index += 1) {
                    context.beginPath();
                    context.arc(Math.cos(index * 1.25) * item.size * .48, Math.sin(index * 1.25) * item.size * .24, item.size * .48, 0, TAU);
                    context.fill();
                }
            } else if (item.kind === 'palm') {
                context.strokeStyle = '#7d4a25'; context.lineWidth = 10; context.lineCap = 'round';
                context.beginPath(); context.moveTo(0, 14); context.quadraticCurveTo(sway * .35, -item.size, sway, -item.size * 1.7); context.stroke();
                context.translate(sway, -item.size * 1.7);
                for (let index = 0; index < 7; index += 1) {
                    context.save(); context.rotate(index / 7 * TAU + sway * .006);
                    context.fillStyle = index % 2 ? '#34b950' : '#1c8f43';
                    context.beginPath(); context.ellipse(item.size * .55, 0, item.size * .72, item.size * .18, 0, 0, TAU); context.fill(); context.restore();
                }
            } else {
                context.fillStyle = '#734624'; roundedRect(context, -6, -item.size, 12, item.size + 14, 5); context.fill();
                context.translate(sway, -item.size * 1.05);
                const crown = context.createRadialGradient(-7, -8, 3, 0, 0, item.size * 1.15);
                crown.addColorStop(0, '#8be556'); crown.addColorStop(1, '#237a40');
                context.fillStyle = crown;
                context.beginPath(); context.arc(0, 0, item.size, 0, TAU); context.fill();
            }
            context.restore();
        }

        drawBuilding(context, building, now) {
            const { x, y, w, h } = building;
            const pulse = .5 + Math.sin(now * .004 + x) * .5;
            context.save();
            context.shadowColor = 'rgba(0,28,32,.42)';
            context.shadowBlur = 24;
            context.shadowOffsetX = 16;
            context.shadowOffsetY = 22;
            context.fillStyle = '#173d32';
            roundedRect(context, x + 8, y + 38, w, h - 20, 22);
            context.fill();
            context.restore();

            const body = context.createLinearGradient(x, y, x, y + h);
            body.addColorStop(0, building.highlight);
            body.addColorStop(1, building.color);
            context.fillStyle = body;
            context.strokeStyle = '#173428';
            context.lineWidth = 8;
            roundedRect(context, x, y + 58, w, h - 58, 18);
            context.fill(); context.stroke();

            context.fillStyle = building.roof;
            context.strokeStyle = '#26362e';
            context.lineWidth = 8;
            context.beginPath();
            context.moveTo(x - 25, y + 72);
            context.lineTo(x + w * .5, y - 4);
            context.lineTo(x + w + 25, y + 72);
            context.lineTo(x + w - 4, y + 106);
            context.lineTo(x + 6, y + 106);
            context.closePath();
            context.fill(); context.stroke();

            context.save();
            context.globalAlpha = .22;
            context.strokeStyle = '#fff'; context.lineWidth = 4;
            for (let stripe = 0; stripe < 7; stripe += 1) {
                const sx = x + 30 + stripe * ((w - 60) / 6);
                context.beginPath(); context.moveTo(x + w / 2, y + 9); context.lineTo(sx, y + 93); context.stroke();
            }
            context.restore();

            const windowY = y + 130;
            for (const wx of [x + 50, x + w - 112]) {
                context.fillStyle = '#102a31'; roundedRect(context, wx, windowY, 62, 58, 9); context.fill();
                const glass = context.createLinearGradient(wx, windowY, wx + 62, windowY + 58);
                glass.addColorStop(0, '#9cf5ff'); glass.addColorStop(1, '#28749b');
                context.fillStyle = glass; roundedRect(context, wx + 7, windowY + 7, 48, 44, 5); context.fill();
                context.strokeStyle = 'rgba(255,255,255,.65)'; context.lineWidth = 3;
                context.beginPath(); context.moveTo(wx + 12, windowY + 37); context.lineTo(wx + 34, windowY + 13); context.stroke();
            }

            const doorTop = y + h - 92;
            context.shadowColor = `rgba(255,228,95,${.35 + pulse * .35})`;
            context.shadowBlur = 18 + pulse * 12;
            context.fillStyle = '#251d26';
            roundedRect(context, building.doorX - 34, doorTop, 68, 92, 12);
            context.fill();
            context.shadowColor = 'transparent';
            context.fillStyle = '#ffd95e'; context.beginPath(); context.arc(building.doorX + 20, doorTop + 48, 5, 0, TAU); context.fill();

            context.textAlign = 'center'; context.textBaseline = 'middle';
            context.font = `900 ${clamp(w * .075, 20, 29)}px Arial`;
            context.lineWidth = 7; context.strokeStyle = '#123226'; context.fillStyle = '#fff6c2';
            const labelY = y + 124;
            context.strokeText(building.name, x + w / 2, labelY); context.fillText(building.name, x + w / 2, labelY);

            if (building.id === 'market') {
                context.fillStyle = '#ffe75b'; context.beginPath(); context.ellipse(x + w / 2, y + 54, 34, 22, -.15, 0, TAU); context.fill();
                context.strokeStyle = '#6b4d13'; context.lineWidth = 5; context.stroke();
            } else if (building.id === 'arcade') {
                for (let bulb = 0; bulb < 9; bulb += 1) {
                    context.fillStyle = `hsl(${(bulb * 42 + now * .04) % 360} 90% 65%)`;
                    context.beginPath(); context.arc(x + 30 + bulb * (w - 60) / 8, y + 99, 6, 0, TAU); context.fill();
                }
            } else if (building.id === 'clan') {
                context.fillStyle = '#ffe36b'; context.strokeStyle = '#375635'; context.lineWidth = 6;
                context.beginPath(); context.moveTo(x + w / 2, y + 22); context.lineTo(x + w / 2 + 27, y + 48); context.lineTo(x + w / 2, y + 83); context.lineTo(x + w / 2 - 27, y + 48); context.closePath(); context.fill(); context.stroke();
            }
            context.restore();
        }

        drawProps(context, now) {
            const lamps = [[1120,690],[1180,1080],[2010,710],[2025,1070],[970,850],[2230,870]];
            for (const [x, y] of lamps) {
                context.strokeStyle = '#25383b'; context.lineWidth = 8; context.beginPath(); context.moveTo(x, y); context.lineTo(x, y - 82); context.stroke();
                context.shadowColor = 'rgba(255,222,107,.75)'; context.shadowBlur = 18;
                context.fillStyle = '#ffe06a'; context.beginPath(); context.arc(x, y - 90, 13, 0, TAU); context.fill(); context.shadowColor = 'transparent';
            }
            const umbrellas = [[430,1270,'#ff6b6b'],[2720,1280,'#7667f0'],[680,1370,'#ffd55b']];
            for (const [x, y, color] of umbrellas) {
                context.strokeStyle = '#7c4c2d'; context.lineWidth = 7; context.beginPath(); context.moveTo(x, y); context.lineTo(x, y - 76); context.stroke();
                context.fillStyle = color; context.strokeStyle = '#fff2c2'; context.lineWidth = 5;
                context.beginPath(); context.arc(x, y - 78, 62, Math.PI, TAU); context.closePath(); context.fill(); context.stroke();
            }
            context.fillStyle = '#fff2b2'; context.font = '34px Arial';
            for (let index = 0; index < 10; index += 1) {
                const x = 340 + index * 270;
                const y = 1500 + Math.sin(index) * 38;
                context.save(); context.translate(x, y); context.rotate(Math.sin(now * .001 + index) * .08); context.fillText(index % 2 ? '✦' : '★', 0, 0); context.restore();
            }
        }

        drawIllustratedAnimation(context, now) {
            const time = now * .001;
            context.save();
            context.lineCap = 'round';

            // The illustrated coast stays crisp while these moving highlights keep the sea alive.
            for (let row = 0; row < 8; row += 1) {
                const y = 45 + row * 58;
                const travel = (time * (48 + row * 4) + row * 91) % 260;
                context.globalAlpha = .20 + (row % 3) * .045;
                context.strokeStyle = row % 2 ? '#a9fbff' : '#ffffff';
                context.lineWidth = 4 + (row % 2) * 2;
                for (let x = -300 + travel; x < this.width + 260; x += 260) {
                    context.beginPath();
                    context.moveTo(x, y + Math.sin(time * 2 + row) * 7);
                    context.bezierCurveTo(x + 42, y - 15, x + 93, y + 13, x + 142, y - 2);
                    context.stroke();
                }
            }

            for (let column = 0; column < 9; column += 1) {
                const x = 55 + column * 58;
                const travel = (time * (34 + column * 3) + column * 77) % 230;
                context.globalAlpha = .18;
                context.strokeStyle = '#c4ffff';
                context.lineWidth = 4;
                context.beginPath();
                context.moveTo(x + Math.sin(time + column) * 7, this.height - 250 + travel);
                context.quadraticCurveTo(x + 34, this.height - 225 + travel, x + 74, this.height - 244 + travel);
                context.stroke();
            }

            // Animated surf along the nearest beach gives the foreground visible motion.
            context.globalAlpha = .58;
            context.strokeStyle = '#e8ffff';
            context.lineWidth = 7;
            context.setLineDash([52, 28]);
            context.lineDashOffset = -now * .045;
            context.beginPath();
            context.moveTo(930, 1710 + Math.sin(time * 2) * 7);
            context.bezierCurveTo(1300, 1635, 1510, 1725, 1780, 1650);
            context.bezierCurveTo(2050, 1585, 2280, 1660, 2500, 1610);
            context.stroke();
            context.setLineDash([]);

            // Fountain jets and ripples are redrawn every frame above the painted plaza.
            context.translate(1636, 955);
            for (let ring = 0; ring < 3; ring += 1) {
                const pulse = (time * 34 + ring * 34) % 94;
                context.globalAlpha = .55 * (1 - pulse / 105);
                context.strokeStyle = '#d9ffff';
                context.lineWidth = 5;
                context.beginPath();
                context.ellipse(0, 10, 55 + pulse, 20 + pulse * .34, 0, 0, TAU);
                context.stroke();
            }
            context.globalAlpha = .76;
            context.strokeStyle = '#f0ffff';
            context.lineWidth = 7;
            for (const direction of [-1, 1]) {
                context.beginPath();
                context.moveTo(direction * 25, 8);
                context.quadraticCurveTo(direction * (42 + Math.sin(time * 3) * 10), -82, direction * 6, -112);
                context.stroke();
            }
            context.restore();

            // Warm lamps, arcade neon, and tiny drifting fireflies animate the town itself.
            context.save();
            const glow = .5 + Math.sin(time * 2.8) * .18;
            for (const [x, y, hue] of [[900,690,'255,213,85'],[1628,528,'255,178,108'],[2450,690,'255,211,100'],[2868,946,'67,224,255'],[2055,1490,'255,220,91']]) {
                const gradient = context.createRadialGradient(x, y, 1, x, y, 48);
                gradient.addColorStop(0, `rgba(${hue},${glow})`);
                gradient.addColorStop(1, `rgba(${hue},0)`);
                context.fillStyle = gradient;
                context.beginPath(); context.arc(x, y, 48, 0, TAU); context.fill();
            }
            for (let index = 0; index < 24; index += 1) {
                const x = 500 + seeded(index, 71) * 2280 + Math.sin(time * (.35 + seeded(index, 72)) + index) * 22;
                const y = 500 + seeded(index, 73) * 930 + Math.cos(time * (.28 + seeded(index, 74)) + index) * 17;
                const alpha = .12 + Math.max(0, Math.sin(time * 2 + index)) * .42;
                context.globalAlpha = alpha;
                context.fillStyle = '#fff79b';
                context.beginPath(); context.arc(x, y, 3 + seeded(index, 75) * 3, 0, TAU); context.fill();
            }
            context.restore();
        }

        drawIllustratedBackground(context, now) {
            context.drawImage(this.backgroundImage, 0, 0, this.width, this.height);
            this.drawIllustratedAnimation(context, now);
        }

        drawForeground() {
            // The coast is one flattened illustration, so rectangular source
            // crops cannot describe the true outline of a roof or wall. Those
            // crops were hiding players standing safely on nearby sidewalks.
            // Keep player sprites above the illustration at all times.
        }

        render(context, { cameraX, cameraY, viewWidth, viewHeight, now, buildings }) {
            context.clearRect(0, 0, viewWidth, viewHeight);
            context.save();
            context.translate(-cameraX, -cameraY);
            if (this.backgroundImage.complete && this.backgroundImage.naturalWidth) this.drawIllustratedBackground(context, now);
            else {
                // Do not render an entirely different procedural town while the
                // real coast artwork is downloading. Besides looking wrong, that
                // fallback drew hundreds of shapes every frame on the slowest
                // devices. This lightweight loading field is replaced as soon as
                // the compressed illustration finishes decoding.
                const loading = context.createLinearGradient(0, 0, 0, this.height);
                loading.addColorStop(0, '#0b7891');
                loading.addColorStop(.55, '#159a88');
                loading.addColorStop(1, '#1f6948');
                context.fillStyle = loading;
                context.fillRect(0, 0, this.width, this.height);
                context.fillStyle = 'rgba(255,239,139,.16)';
                context.beginPath();
                context.arc(this.width / 2, this.height / 2, 260 + Math.sin(now * .002) * 12, 0, TAU);
                context.fill();
            }
            context.globalAlpha = 1;
            context.restore();

            const vignette = context.createRadialGradient(viewWidth / 2, viewHeight / 2, viewHeight * .25, viewWidth / 2, viewHeight / 2, Math.max(viewWidth, viewHeight) * .72);
            vignette.addColorStop(0, 'rgba(0,0,0,0)');
            vignette.addColorStop(1, 'rgba(2,24,35,.22)');
            context.fillStyle = vignette; context.fillRect(0, 0, viewWidth, viewHeight);
        }
    }

    global.FlappyMonkeyWorldRenderer = BananaCoastRenderer;
})(window);
