local BRIDGE_URL  = "http://127.0.0.1:3000/api/update"
local UPDATE_RATE = 0.1

local ENTITY_FILTER = {
    ["prop_physics"]         = true,
    ["prop_dynamic"]         = true,
    ["npc_combine_s"]        = true,
    ["npc_zombie"]           = true,
    ["npc_metropolice"]      = true,
    ["prop_vehicle_jeep"]    = true,
    ["prop_vehicle_airboat"] = true,
}

local function serializePlayers()
    local t = {}
    for _, ply in ipairs(player.GetAll()) do
        if not IsValid(ply) then continue end
        local pos = ply:GetPos()
        local ang = ply:GetAngles()
        table.insert(t, {
            steamid = ply:SteamID(),
            name    = ply:Nick(),
            pos     = { pos.x, pos.y, pos.z },
            ang     = { ang.p, ang.y, ang.r },
            health  = ply:Health(),
            armor   = ply:Armor(),
            alive   = ply:Alive(),
            team    = team.GetName(ply:Team()),
            weapon  = IsValid(ply:GetActiveWeapon()) and ply:GetActiveWeapon():GetClass() or "none",
        })
    end
    return t
end

local function serializeEntities()
    local t = {}
    for _, ent in ipairs(ents.GetAll()) do
        if not IsValid(ent) then continue end
        if not ENTITY_FILTER[ent:GetClass()] then continue end
        local pos = ent:GetPos()
        table.insert(t, {
            id    = ent:EntIndex(),
            class = ent:GetClass(),
            model = ent:GetModel() or "",
            pos   = { pos.x, pos.y, pos.z },
        })
        if #t >= 200 then break end --// safety cap
    end
    return t
end

local function sendUpdate()
    HTTP({
        url     = BRIDGE_URL,
        method  = "POST",
        headers = { ["Content-Type"] = "application/json" },
        body    = util.TableToJSON({
            players  = serializePlayers(),
            entities = serializeEntities(),
            map      = game.GetMap(),
        }),
        success = function(code)
            if code ~= 200 then print("[GMap] bridge returned HTTP " .. code) end
        end,
        failed = function(reason)
            print("[GMap] HTTP error: " .. tostring(reason))
        end,
    })
end

timer.Create("GMap_Update", UPDATE_RATE, 0, sendUpdate)

hook.Add("PlayerSay", "GMap_ChatCmd", function(ply, text)
    if text:lower() ~= "!gmap" then return end
    ply:ChatPrint("[GMap] viewer: http://<server-ip>:3000")
end)

print("[GMap] loaded → " .. BRIDGE_URL)
