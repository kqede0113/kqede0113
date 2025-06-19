const enchantmentsData = [
    // 武器
    { id: 'sharpness', name: 'シャープネス', maxLevel: 5 },
    { id: 'smite', name: 'アンデッド特効', maxLevel: 5 },
    { id: 'bane_of_arthropods', name: '虫特効', maxLevel: 5 },
    { id: 'knockback', name: 'ノックバック', maxLevel: 2 },
    { id: 'fire_aspect', name: '火属性', maxLevel: 2 },
    { id: 'looting', name: 'ドロップ増加', maxLevel: 3 },
    { id: 'sweeping', name: '範囲ダメージ増加', maxLevel: 3 },
    // 弓
    { id: 'power', name: 'パワー', maxLevel: 5 },
    { id: 'punch', name: 'パンチ', maxLevel: 2 },
    { id: 'flame', name: 'フレイム', maxLevel: 1 },
    { id: 'infinity', name: '無限', maxLevel: 1 },
    // クロスボウ
    { id: 'quick_charge', name: '高速装填', maxLevel: 3 },
    { id: 'multishot', name: '拡散', maxLevel: 1 },
    { id: 'piercing', name: '貫通', maxLevel: 4 },
    // トライデント
    { id: 'impaling', name: '串刺し', maxLevel: 5 },
    { id: 'riptide', name: '激流', maxLevel: 3 },
    { id: 'loyalty', name: '忠誠', maxLevel: 3 },
    { id: 'channeling', name: '召雷', maxLevel: 1 },
    // 防具共通
    { id: 'protection', name: 'ダメージ軽減', maxLevel: 4 },
    { id: 'fire_protection', name: '火炎耐性', maxLevel: 4 },
    { id: 'feather_falling', name: '落下耐性', maxLevel: 4 },
    { id: 'blast_protection', name: '爆発耐性', maxLevel: 4 },
    { id: 'projectile_protection', name: '飛び道具耐性', maxLevel: 4 },
    { id: 'thorns', name: 'とげ', maxLevel: 3 },
    { id: 'unbreaking', name: '耐久力', maxLevel: 3 },
    { id: 'mending', name: '修繕', maxLevel: 1 },
    // ヘルメット専用
    { id: 'respiration', name: '水中呼吸', maxLevel: 3 },
    { id: 'aqua_affinity', name: '水中採掘', maxLevel: 1 },
    // ブーツ専用
    { id: 'depth_strider', name: '水中移動', maxLevel: 3 },
    { id: 'frost_walker', name: '氷渡り', maxLevel: 2 },
    { id: 'soul_speed', name: 'ソウルスピード', maxLevel: 3 },
    // ツール
    { id: 'efficiency', name: '効率強化', maxLevel: 5 },
    { id: 'silk_touch', name: 'シルクタッチ', maxLevel: 1 },
    { id: 'fortune', name: '幸運', maxLevel: 3 },
    // 釣り竿
    { id: 'luck_of_the_sea', name: '宝釣り', maxLevel: 3 },
    { id: 'lure', name: '入れ食い', maxLevel: 3 },
    // ハサミ
    { id: 'swift_sneak', name: '俊敏', maxLevel: 3 },
    // 盾
    { id: 'unbreaking', name: '耐久力', maxLevel: 3 }, // 盾も耐久力可
    { id: 'mending', name: '修繕', maxLevel: 1 },      // 盾も修繕可
    // その他（カスタム・カメ・馬鎧など）
    { id: 'binding_curse', name: '束縛の呪い', maxLevel: 1 },
    { id: 'vanishing_curse', name: '消滅の呪い', maxLevel: 1 }
];


// エンチャント選択UIの生成
function initEnchantments() {
    const container = document.getElementById('enchantments');
    enchantmentsData.forEach(ench => {
        const div = document.createElement('div');
        div.className = 'enchantment-item';
        div.innerHTML = `
            <input type="checkbox" id="${ench.id}" class="ench-checkbox">
            <label for="${ench.id}">${ench.name}</label>
            <select id="${ench.id}-level" class="ench-level" disabled>
                ${Array.from({length: ench.maxLevel}, (_, i) => `<option>${i+1}</option>`)}
            </select>
        `;
        
        div.querySelector('input').addEventListener('change', (e) => {
            div.querySelector('select').disabled = !e.target.checked;
        });
        
        container.appendChild(div);
    });
}

function generateCommand() {
    const itemType = document.getElementById('item-type').value;
    const enchants = [];
    
    document.querySelectorAll('.enchantment-item').forEach(item => {
        const checkbox = item.querySelector('input');
        if (checkbox.checked) {
            const id = checkbox.id;
            const level = item.querySelector('select').value;
            enchants.push(`"${id}":${level}`);
        }
    });

    const enchantString = enchants.join(',');
    const command = `/give @p ${itemType}[enchantments={${enchantString}}] 1`;
    
    document.getElementById('output').value = command;
}


// クリップボードコピー機能
function copyToClipboard() {
    const output = document.getElementById('output');
    output.select();
    document.execCommand('copy');
    alert('コマンドをクリップボードにコピーしました！');
}

// 初期化
document.addEventListener('DOMContentLoaded', initEnchantments);
