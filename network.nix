# Network parameters for the agent + firewall VMs. Imported by agent-vm.nix,
# firewall-vm.nix, and home.nix so a single source of truth drives all the
# IPs and the subnet prefix.
#
# Per-instance overrides are copied into the guest as network-local.nix, which
# `rootcell` generates from the instance state directory's state.json. If
# that file doesn't exist (e.g. you're running `nix flake check` outside the
# script), the defaults below apply.
#
# To change these for one instance, edit that instance's state/config and run
# `./rootcell --instance <name> provision`. To change project-wide fallback
# defaults, edit this file.

let
  defaults = {
    # IP of the firewall VM on the private inter-VM network. The agent VM uses
    # this as its default route, DNS server, and SSH proxy.
    #
    # Keep .1 free for host-side or control-plane addresses if the private link
    # implementation changes later.
    firewallIp = "192.168.100.2";

    # IP of the agent VM on the same private network.
    agentIp = "192.168.100.3";

    # Subnet prefix length for the inter-VM network.
    networkPrefix = 24;

    # Fallback interface names used when rootcell has not generated
    # per-instance MAC-address metadata.
    agentPrivateInterface = "enp0s1";
    firewallPrivateInterface = "enp0s2";
    firewallEgressInterface = "enp0s1";
    firewallControlInterface = "enp0s1";
  };

  override =
    if builtins.pathExists ./network-local.nix
    then import ./network-local.nix
    else { };
in
defaults // override
